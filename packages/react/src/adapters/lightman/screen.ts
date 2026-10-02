import type { CellExtAttr, Field, FieldColor, ScreenData, SelectionField, Window } from 'green-screen-types';
import type { LightmanField, LightmanScreen, LightmanSource } from './types';

const FIELD_COLORS = new Set<string>([
    'green', 'white', 'red', 'turquoise', 'yellow', 'pink', 'blue',
]);

const SHIFT_TYPES = new Set<string>([
    'alpha', 'alpha_only', 'numeric_shift', 'numeric_only',
    'katakana', 'digits_only', 'io', 'signed_num',
]);

const EXT_COLOR_CODES: Record<string, number> = {
    green: 0,
    blue: 1,
    red: 2,
    pink: 3,
    turquoise: 4,
    yellow: 5,
    white: 6,
};

const DEFAULT_ROWS = 24;
const DEFAULT_COLS = 80;

/** Lightman reports colors the green-screen `FieldColor` union has no member for (e.g. `'black'`). */
function toFieldColor(color: string | undefined): FieldColor | undefined {
    return color !== undefined && FIELD_COLORS.has(color) ? (color as FieldColor) : undefined;
}

function toShiftType(shiftType: string | undefined): Field['shift_type'] | undefined {
    return shiftType !== undefined && SHIFT_TYPES.has(shiftType)
        ? (shiftType as Field['shift_type'])
        : undefined;
}

/**
 * `modernizedUI` sources nest the screen one level deeper than terminal sources.
 * A missing `interface` is treated as `'terminal'`.
 */
export function unwrapScreen(source: LightmanSource): LightmanScreen {
    return source.screen ?? source;
}

/** True when the source renders a plain green screen rather than a modernized UI. */
export function isTerminalSource(source: LightmanSource): boolean {
    return source.interface !== 'modernizedUI';
}

/** FNV-1a over the rendered screen, used to re-sign locally edited screens. */
export function computeSignature(content: string, cursorRow: number, cursorCol: number): string {
    let hash = 0x811c9dc5;
    const input = `${content}\u0000${cursorRow},${cursorCol}`;
    for (let i = 0; i < input.length; i++) {
        hash ^= input.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
}

function padRow(row: string, cols: number): string {
    return row.length >= cols ? row.slice(0, cols) : row.padEnd(cols, ' ');
}

/**
 * `lines` is the authoritative grid: `content` drops trailing blank rows, so it
 * routinely reports fewer than `rows` lines.
 */
function buildContent(screen: LightmanScreen, rows: number, cols: number): string {
    const source = screen.lines ?? (screen.content ?? '').split('\n');
    const grid: string[] = [];
    for (let i = 0; i < rows; i++) {
        grid.push(padRow(source[i] ?? '', cols));
    }
    return grid.join('\n');
}

function toField(field: LightmanField): Field {
    const raw = field.raw5250;
    const mapped: Field = {
        row: field.row,
        col: field.col,
        length: field.length,
        is_input: field.is_input,
        is_protected: field.is_protected,
    };

    // Only `tn5250_field` entries carry a host-declared width; display segments are measured runs.
    if (raw !== undefined) mapped.length_source = 'declared';
    if (field.is_highlighted !== undefined) mapped.is_highlighted = field.is_highlighted;
    if (field.is_reverse !== undefined) mapped.is_reverse = field.is_reverse;
    if (field.is_underscored !== undefined) mapped.is_underscored = field.is_underscored;
    if (field.is_non_display !== undefined) mapped.is_non_display = field.is_non_display;

    const color = toFieldColor(field.color);
    if (color !== undefined) mapped.color = color;

    const shiftType = toShiftType(field.shift_type);
    if (shiftType !== undefined) mapped.shift_type = shiftType;

    if (field.monocase !== undefined) mapped.monocase = field.monocase;
    if (field.auto_enter !== undefined) mapped.auto_enter = field.auto_enter;
    if (field.mandatory_entry !== undefined) mapped.mandatory_entry = field.mandatory_entry;
    if (raw?.isFER !== undefined) mapped.field_exit_required = raw.isFER;
    if (raw?.isDupEnabled !== undefined) mapped.dup_enable = raw.isDupEnabled;
    mapped.modified = field.modified === true;

    return mapped;
}

function toWindows(screen: LightmanScreen): Window[] | undefined {
    const windows = screen.screen_meta?.windows;
    return windows !== undefined && windows.length > 0 ? windows : undefined;
}

function toSelectionFields(screen: LightmanScreen): SelectionField[] | undefined {
    const choices = screen.screen_meta?.choiceFields;
    return choices !== undefined && choices.length > 0 ? choices : undefined;
}

function toExtendedAttributes(screen: LightmanScreen, rows: number, cols: number): Record<number, CellExtAttr> | undefined {
    const spans = screen.planes?.spans;
    if (spans === undefined || spans.length === 0) return undefined;

    const attributes: Record<number, CellExtAttr> = {};
    for (const span of spans) {
        if (span.row < 0 || span.row >= rows || span.col < 0 || span.length <= 0) continue;

        const background = span.bg_color?.toLowerCase();
        const foreground = span.color?.toLowerCase();
        let color: number | undefined;
        if (background !== undefined && background !== 'black' && EXT_COLOR_CODES[background] !== undefined) {
            color = EXT_COLOR_CODES[background] | 0x08;
        } else if (foreground !== undefined && foreground !== 'black') {
            color = EXT_COLOR_CODES[foreground];
        }

        let highlight = 0;
        if (span.is_reverse) highlight |= 0x02;
        if (span.is_blink) highlight |= 0x04;
        if (span.is_column_separator) highlight |= 0x08;

        const startCol = Math.max(0, span.col);
        const endCol = Math.min(cols, span.col + span.length);
        for (let col = startCol; col < endCol; col++) {
            const attr: CellExtAttr = {};
            if (color !== undefined) attr.color = color;
            if (highlight > 0) attr.highlight = highlight;
            if (Object.keys(attr).length > 0) attributes[span.row * cols + col] = attr;
        }
    }

    return Object.keys(attributes).length > 0 ? attributes : undefined;
}

/**
 * Normalizes any `sources` entry of `LIGHTMAL.open`, `.get` or `.write` into the
 * canonical green-screen `ScreenData`.
 *
 * `planes.spans` are expanded to per-cell extended attributes so residual
 * background-color art survives the conversion.
 */
export function toScreenData(source: LightmanSource): ScreenData {
    const screen = unwrapScreen(source);
    const rows = screen.rows ?? DEFAULT_ROWS;
    const cols = screen.cols ?? DEFAULT_COLS;
    const content = buildContent(screen, rows, cols);
    const cursorRow = screen.cursor_row ?? 0;
    const cursorCol = screen.cursor_col ?? 0;

    const data: ScreenData = {
        content,
        cursor_row: cursorRow,
        cursor_col: cursorCol,
        rows,
        cols,
        fields: (screen.fields ?? []).map(toField),
        screen_signature: screen.screen_signature ?? computeSignature(content, cursorRow, cursorCol),
        timestamp: screen.timestamp ?? new Date().toISOString(),
    };

    if (screen.screen_id !== undefined) data.screen_id = screen.screen_id;
    if (screen.structural_signature !== undefined) data.structural_signature = screen.structural_signature;
    if (screen.keyboard_locked !== undefined) data.keyboard_locked = screen.keyboard_locked;
    if (screen.message_waiting !== undefined) data.message_waiting = screen.message_waiting;
    if (screen.alarm !== undefined) data.alarm = screen.alarm;
    if (screen.insert_mode !== undefined) data.insert_mode = screen.insert_mode;

    const windows = toWindows(screen);
    if (windows !== undefined) {
        data.windows = windows;
        data.is_popup = true;
    }

    const selectionFields = toSelectionFields(screen);
    if (selectionFields !== undefined) data.selection_fields = selectionFields;

    const extAttrs = toExtendedAttributes(screen, rows, cols);
    if (extAttrs !== undefined) data.ext_attrs = extAttrs;

    return data;
}

/** Linear cell offset, the addressing model 5250 fields use when they wrap rows. */
function offsetOf(row: number, col: number, cols: number): number {
    return row * cols + col;
}

/** The unprotected field covering a cell, honouring multi-row fields. */
export function findInputFieldAt(screen: ScreenData, row: number, col: number): Field | null {
    const position = offsetOf(row, col, screen.cols);
    for (const field of screen.fields) {
        if (!field.is_input || field.is_protected) continue;
        const start = offsetOf(field.row, field.col, screen.cols);
        if (position >= start && position < start + field.length) return field;
    }
    return null;
}

function toGrid(screen: ScreenData): string[] {
    const rows = screen.content.split('\n');
    const grid: string[] = [];
    for (let i = 0; i < screen.rows; i++) {
        grid.push(padRow(rows[i] ?? '', screen.cols));
    }
    return grid;
}

/** Current on-screen text of a field, read across row boundaries. */
export function readFieldValue(screen: ScreenData, field: Field): string {
    const flat = toGrid(screen).join('');
    const start = offsetOf(field.row, field.col, screen.cols);
    return flat.slice(start, start + field.length);
}

/**
 * Writes `value` into a field and returns a re-signed copy of the screen.
 * The value is clipped and space-padded to the field's declared width, and the
 * field is flagged modified so the next AID key includes it in the write.
 */
export function writeFieldValue(screen: ScreenData, field: Field, value: string): ScreenData {
    const flat = toGrid(screen).join('');
    const start = offsetOf(field.row, field.col, screen.cols);
    const padded = value.slice(0, field.length).padEnd(field.length, ' ');
    const updated = flat.slice(0, start) + padded + flat.slice(start + field.length);

    const grid: string[] = [];
    for (let i = 0; i < screen.rows; i++) {
        grid.push(updated.slice(i * screen.cols, (i + 1) * screen.cols));
    }
    const content = grid.join('\n');

    return {
        ...screen,
        content,
        fields: screen.fields.map((f) => (f === field ? { ...f, modified: true } : f)),
        screen_signature: computeSignature(content, screen.cursor_row, screen.cursor_col),
    };
}

/** Returns a re-signed copy of the screen with the cursor moved. */
export function withCursor(screen: ScreenData, row: number, col: number): ScreenData {
    return {
        ...screen,
        cursor_row: row,
        cursor_col: col,
        screen_signature: computeSignature(screen.content, row, col),
    };
}
