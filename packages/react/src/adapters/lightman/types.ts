/**
 * Wire-format types for the Lightman Router API.
 *
 * All actions are POSTed as JSON to a single `/router` endpoint and answer with
 * the same envelope: `{ lightman_id, sources: { "<source_id>": LightmanSource } }`.
 *
 * Two source shapes exist and are distinguished by `interface`:
 * - `'terminal'` (or absent) — the screen fields sit flat on the source object
 * - `'modernizedUI'`         — the screen sits under `screen`, named program
 *                              values sit under `data`
 */

/** Source identifier. The router keys `sources` by its string form. */
export type SourceRequestId = number;

/** 5250 field attributes as emitted by the Lightman bridge. */
export interface LightmanRaw5250 {
    startPos: number;
    endPos: number;
    currentPos: number;
    fieldId: number;
    /** Width the host declared in its SF order. */
    fieldLength: number;
    adjustment: number;
    attr: number;
    attrHex: string;
    ffw1: number;
    ffw2: number;
    fcw1: number;
    fcw2: number;
    cursorProgression: number;
    /** Field Exit Required. */
    isFER: boolean;
    isHighlightedEntry: boolean;
    isRightToLeft: boolean;
    isDupEnabled: boolean;
    isContinued: boolean;
    isContinuedFirst: boolean;
    isContinuedMiddle: boolean;
    isContinuedLast: boolean;
}

/**
 * A screen field. Input fields carry `source: 'tn5250_field'` and a `raw5250`
 * block; protected text runs carry `source: 'display_segment'` and neither.
 */
export interface LightmanField {
    /** Positional identifier, e.g. `"r005c050l008"` (input) or `"dr000c001l79"` (display). */
    id: string;
    /** Sequential identifier within its kind, e.g. `"i0"` for input, `"o0"` for output. */
    indexName: string;
    index: number;
    /** 0-based row. */
    row: number;
    /** 0-based column. */
    col: number;
    length: number;
    value: string;
    is_input: boolean;
    is_protected: boolean;
    is_highlighted?: boolean;
    is_reverse?: boolean;
    is_underscored?: boolean;
    is_non_display?: boolean;
    is_blink?: boolean;
    is_column_separator?: boolean;
    /** May be `'black'` or another value outside the green-screen FieldColor union. */
    color?: string;
    bg_color?: string;
    modified?: boolean;
    shift_type?: string;
    monocase?: boolean;
    auto_enter?: boolean;
    mandatory_entry?: boolean;
    source?: 'tn5250_field' | 'display_segment' | string;
    raw5250?: LightmanRaw5250;
}

/** Styled cell run not covered by any field. */
export interface LightmanPlaneSpan {
    row: number;
    col: number;
    length: number;
    is_highlighted?: boolean;
    is_reverse?: boolean;
    is_underscored?: boolean;
    is_non_display?: boolean;
    is_blink?: boolean;
    is_column_separator?: boolean;
    color?: string;
    bg_color?: string;
}

export interface LightmanPlanes {
    format: string;
    note?: string;
    spans: LightmanPlaneSpan[];
}

export interface LightmanWindow {
    row: number;
    col: number;
    height: number;
    width: number;
    title?: string;
    footer?: string;
}

export interface LightmanChoiceField {
    row: number;
    col: number;
    num_rows: number;
    num_cols: number;
    choices: { text: string; row: number; col: number }[];
}

export interface LightmanScreenMeta {
    screenLength?: number;
    currentPos?: number;
    cursorActive?: boolean;
    cursorShown?: boolean;
    fingerprint?: string;
    /**
     * 24 booleans nominally marking F1..F24 as enabled. Observed to go stale
     * across screen transitions, so it is deliberately not mapped.
     */
    activeAidKeys?: boolean[];
    errorLine?: number;
    statusErrorCode?: boolean;
    errorText?: string;
    home?: { rawHomePos: number; row: number; col: number };
    windows?: LightmanWindow[];
    choiceFields?: LightmanChoiceField[];
}

/** The screen payload, either flat on the source or nested under `screen`. */
export interface LightmanScreen {
    sessionId?: string;
    /** Monotonic change counter. Only changes when the screen actually changed. */
    version?: number;
    content?: string;
    /** Authoritative row grid — always prefer this over `content`. */
    lines?: string[];
    cursor_row?: number;
    cursor_col?: number;
    rows?: number;
    cols?: number;
    screen_signature?: string;
    structural_signature?: string;
    screen_id?: string;
    timestamp?: string;
    keyboard_locked?: boolean;
    message_waiting?: boolean;
    alarm?: boolean;
    insert_mode?: boolean;
    fields?: LightmanField[];
    planes?: LightmanPlanes;
    screen_meta?: LightmanScreenMeta;
}

/** Rendering mode of a source. A missing value is treated as `'terminal'`. */
export type LightmanInterface = 'terminal' | 'modernizedUI';

/** One entry of the `sources` map. Extends the flat terminal screen shape. */
export interface LightmanSource extends LightmanScreen {
    success?: boolean;
    source?: string;
    source_id?: string;
    program_name?: string;
    library?: string;
    lightman_id?: string;
    interface?: LightmanInterface | string;
    /** Named program values — `modernizedUI` sources only. */
    data?: Record<string, string>;
    /** Nested screen — `modernizedUI` sources only. */
    screen?: LightmanScreen;
}

/** Shared envelope of `LIGHTMAL.open`, `.get` and `.write`. */
export interface LightmanSourcesResponse {
    lightman_id?: string;
    sources?: Record<string, LightmanSource>;
    success?: boolean;
    error?: string;
}

/** Per-source payload of a `LIGHTMAL.write` request. */
export interface LightmanWritePayload {
    data: Record<string, string>;
    changedFields: LightmanChangedField[];
    functionKey?: string;
}

/** A field update repeated in the router's explicit change list. */
export interface LightmanChangedField {
    id: string;
    value: string;
}

export interface LightmanUIModuleListResponse {
    success?: boolean;
    modules?: unknown[];
    error?: string;
}

/**
 * Which field property is used as the key inside a write's `data` object.
 *
 * `modernizedUI` sources are addressed by named program fields (`#1NAME`), but
 * the key scheme for plain terminal sources is not documented — hence the
 * switch. `'rpgName'` reuses the names from the source's `data` map.
 */
export type LightmanFieldKeyStrategy = 'indexName' | 'id' | 'rpgName';
