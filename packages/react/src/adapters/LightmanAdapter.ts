import type { FetchLike, LightmanRequestListener } from './lightman/client';
import { LightmanRouterClient } from './lightman/client';
import { isAidKey, moveCursor, toFunctionKey } from './lightman/keys';
import {
    findInputFieldAt,
    isTerminalSource,
    readFieldValue,
    toScreenData,
    unwrapScreen,
    withCursor,
    writeFieldValue,
} from './lightman/screen';
import type {
    LightmanField,
    LightmanFieldKeyStrategy,
    LightmanSource,
    LightmanSourcesResponse,
    LightmanWritePayload,
    SourceRequestId,
} from './lightman/types';
import type { ConnectionStatus, Field, FieldValue, ScreenData, SendResult, TerminalAdapter } from './types';

export interface LightmanAdapterOptions {
    /** Router endpoint. Defaults to the dev-proxy path `/api/lightman/router`. */
    routerUrl?: string;
    /** UI key passed to `LIGHTMAL.open`. */
    uiKey?: string;
    /** User passed to `LIGHTMAL.open`. */
    user?: string;
    /** Resumes an existing session via `LIGHTMAL.get` instead of opening a new one. */
    lightmanId?: string;
    /** Selects a specific source; defaults to the first terminal source. */
    sourceId?: SourceRequestId;
    /** Which field property keys the `data` object of a write. Defaults to `'indexName'`. */
    fieldKeyStrategy?: LightmanFieldKeyStrategy;
    /** Polls `LIGHTMAL.get` at this interval to pick up host-driven changes. `0` disables. */
    pollIntervalMs?: number;
    /** Extra headers merged into every request. */
    headers?: Record<string, string>;
    /** Overrides `globalThis.fetch`. */
    fetchImpl?: FetchLike;
    /** Called with the session id once a session is opened or resumed. */
    onLightmanIdChange?: (lightmanId: string) => void;
    /** Called after every router round-trip. */
    onRequest?: LightmanRequestListener;
}

/**
 * Terminal adapter backed by the Lightman Router API.
 *
 * Unlike the proxy-based adapters, Lightman has no per-keystroke channel: it
 * exchanges whole screens. Typing is therefore applied to a local buffer and
 * only an AID key (`ENTER`, `F1`–`F24`, …) triggers a single `LIGHTMAL.write`
 * carrying the modified fields. Screen updates are pushed through `onScreen`,
 * so mount the terminal with `pollInterval={0}`.
 *
 * Writing is supported for terminal sources; `modernizedUI` sources are
 * rendered read-only.
 */
export class LightmanAdapter implements TerminalAdapter {
    private client: LightmanRouterClient;
    private uiKey: string;
    private user?: string;
    private requestedSourceId?: SourceRequestId;
    private fieldKeyStrategy: LightmanFieldKeyStrategy;
    private pollIntervalMs: number;
    private onLightmanIdChange?: (lightmanId: string) => void;

    private lightmanId?: string;
    private sourceId?: SourceRequestId;
    private source?: LightmanSource;
    private screen: ScreenData | null = null;
    private connected = false;
    private version?: number;
    private rawFieldsByPosition = new Map<string, LightmanField>();
    private listeners = new Set<(screen: ScreenData) => void>();
    private pollTimer?: ReturnType<typeof setInterval>;

    constructor(options: LightmanAdapterOptions = {}) {
        this.client = new LightmanRouterClient({
            routerUrl: options.routerUrl,
            headers: options.headers,
            fetchImpl: options.fetchImpl,
            onRequest: options.onRequest,
        });
        this.uiKey = options.uiKey || 'terminal';
        this.user = options.user;
        this.lightmanId = options.lightmanId;
        this.requestedSourceId = options.sourceId;
        this.fieldKeyStrategy = options.fieldKeyStrategy || 'indexName';
        this.pollIntervalMs = options.pollIntervalMs ?? 0;
        this.onLightmanIdChange = options.onLightmanIdChange;
    }

    /** Session id of the active session, once opened or resumed. */
    get sessionId(): string | undefined {
        return this.lightmanId;
    }

    /** Source id the adapter is bound to. */
    get activeSourceId(): SourceRequestId | undefined {
        return this.sourceId;
    }

    async getScreen(): Promise<ScreenData | null> {
        return this.screen;
    }

    async getStatus(): Promise<ConnectionStatus> {
        return {
            connected: this.connected,
            status: this.connected ? 'authenticated' : 'disconnected',
            protocol: 'tn5250',
        };
    }

    async connect(): Promise<SendResult> {
        try {
            const response = this.lightmanId !== undefined
                ? await this.client.get(this.lightmanId, this.resolveSourcesForGet())
                : await this.client.open(this.uiKey, this.user);
            this.adoptResponse(response);
            this.connected = true;
            this.startPolling();
            return this.ok();
        } catch (e: unknown) {
            return this.fail(e);
        }
    }

    async disconnect(): Promise<SendResult> {
        this.stopPolling();
        this.connected = false;
        this.screen = null;
        this.source = undefined;
        this.version = undefined;
        this.rawFieldsByPosition.clear();
        return { success: true };
    }

    async reconnect(): Promise<SendResult> {
        await this.disconnect();
        return this.connect();
    }

    onScreen(listener: (screen: ScreenData) => void): () => void {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    }

    /** Stops polling. Listeners are released through their own unsubscribe. */
    dispose(): void {
        this.stopPolling();
    }

    async sendText(text: string): Promise<SendResult> {
        const screen = this.screen;
        if (screen === null) return { success: false, error: 'Not connected' };
        if (!this.isWritable()) return { success: false, error: 'Source is read-only' };

        const field = findInputFieldAt(screen, screen.cursor_row, screen.cursor_col);
        if (field === null) return { success: false, error: 'Cursor is not in an input field' };

        const fieldStart = field.row * screen.cols + field.col;
        const offset = screen.cursor_row * screen.cols + screen.cursor_col - fieldStart;
        const current = readFieldValue(screen, field);
        const next = current.slice(0, offset) + text + current.slice(offset + text.length);

        const written = writeFieldValue(screen, field, next);
        const cursor = this.clampToField(field, fieldStart + offset + text.length, written.cols);
        this.emit(withCursor(written, cursor.row, cursor.col));
        return this.ok();
    }

    async sendKey(key: string): Promise<SendResult> {
        const screen = this.screen;
        if (screen === null) return { success: false, error: 'Not connected' };

        if (isAidKey(key)) {
            if (!this.isWritable()) return { success: false, error: 'Source is read-only' };
            return this.submit(key);
        }
        return this.applyLocalKey(key, screen);
    }

    async setCursor(row: number, col: number): Promise<SendResult> {
        const screen = this.screen;
        if (screen === null) return { success: false, error: 'Not connected' };
        this.emit(withCursor(screen, row, col));
        return this.ok();
    }

    async readMdt(modifiedOnly = true): Promise<FieldValue[]> {
        const screen = this.screen;
        if (screen === null) return [];
        return screen.fields
            .filter((field) => field.is_input && !field.is_protected)
            .filter((field) => !modifiedOnly || field.modified === true)
            .map((field) => ({
                row: field.row,
                col: field.col,
                length: field.length,
                value: readFieldValue(screen, field),
                modified: field.modified === true,
            }));
    }

    // --- Session handling ---

    private resolveSourcesForGet(): SourceRequestId[] {
        const sourceId = this.sourceId ?? this.requestedSourceId;
        return sourceId !== undefined ? [sourceId] : [];
    }

    private adoptResponse(response: LightmanSourcesResponse): void {
        if (response.lightman_id !== undefined && response.lightman_id !== this.lightmanId) {
            this.lightmanId = response.lightman_id;
            this.onLightmanIdChange?.(response.lightman_id);
        }

        const source = this.selectSource(response);
        if (source === null) throw new Error('Lightman response contained no usable source');

        this.source = source;
        this.sourceId = Number(source.source_id ?? this.requestedSourceId);
        this.version = unwrapScreen(source).version;
        this.indexRawFields(source);
        this.emit(toScreenData(source));
    }

    private selectSource(response: LightmanSourcesResponse): LightmanSource | null {
        const entries = Object.entries(response.sources ?? {});
        if (entries.length === 0) return null;

        if (this.requestedSourceId !== undefined) {
            const match = entries.find(([id]) => Number(id) === this.requestedSourceId);
            if (match !== undefined) return match[1];
        }
        const terminal = entries.find(([, source]) => isTerminalSource(source));
        return (terminal ?? entries[0])[1];
    }

    private indexRawFields(source: LightmanSource): void {
        this.rawFieldsByPosition.clear();
        for (const field of unwrapScreen(source).fields ?? []) {
            if (field.is_input) this.rawFieldsByPosition.set(`${field.row},${field.col}`, field);
        }
    }

    private isWritable(): boolean {
        return this.source !== undefined && isTerminalSource(this.source);
    }

    // --- Writing ---

    private async submit(key: string): Promise<SendResult> {
        const screen = this.screen;
        if (screen === null || this.lightmanId === undefined || this.sourceId === undefined) {
            return { success: false, error: 'Not connected' };
        }

        const data = this.collectModifiedFields(screen);
        const payload: LightmanWritePayload = {
            data,
            changedFields: Object.entries(data).map(([id, value]) => ({ id, value })),
            functionKey: toFunctionKey(key),
        };

        try {
            const response = await this.client.write(this.lightmanId, { [String(this.sourceId)]: payload });
            this.adoptResponse(response);
            return this.ok();
        } catch (e: unknown) {
            return this.fail(e);
        }
    }

    private collectModifiedFields(screen: ScreenData): Record<string, string> {
        const data: Record<string, string> = {};
        const inputFields = screen.fields.filter((field) => field.is_input && !field.is_protected);
        inputFields.forEach((field, index) => {
            if (field.modified !== true) return;
            const key = this.fieldKey(field, index);
            if (key !== null) data[key] = readFieldValue(screen, field).trimEnd();
        });
        return data;
    }

    private fieldKey(field: Field, inputIndex: number): string | null {
        if (this.fieldKeyStrategy === 'rpgName') return this.rpgNameFor(inputIndex);
        const raw = this.rawFieldsByPosition.get(`${field.row},${field.col}`);
        if (raw === undefined) return null;
        return this.fieldKeyStrategy === 'id' ? raw.id : raw.indexName;
    }

    /**
     * Heuristic: the source's `data` map holds named program values in declaration
     * order but also non-input entries. `##`-prefixed keys are dropped, then the
     * remainder is aligned positionally with the screen's input fields.
     */
    private rpgNameFor(inputIndex: number): string | null {
        const names = Object.keys(this.source?.data ?? {}).filter((name) => !name.startsWith('##'));
        return names[inputIndex] ?? null;
    }

    // --- Local key handling ---

    private applyLocalKey(key: string, screen: ScreenData): SendResult {
        const moved = moveCursor(key, screen.cursor_row, screen.cursor_col, screen.rows, screen.cols);
        if (moved !== null) {
            this.emit(withCursor(screen, moved.row, moved.col));
            return this.ok();
        }

        switch (key) {
            case 'TAB':
                return this.focusField(this.nextInputField(screen, 1));
            case 'BACKTAB':
                return this.focusField(this.nextInputField(screen, -1));
            case 'HOME':
                return this.focusField(screen.fields.find((f) => f.is_input && !f.is_protected) ?? null);
            case 'BACKSPACE':
                return this.eraseCharacter(screen, -1);
            case 'DELETE':
                return this.eraseCharacter(screen, 0);
            default:
                return this.ok();
        }
    }

    private focusField(field: Field | null): SendResult {
        const screen = this.screen;
        if (screen === null || field === null) return this.ok();
        this.emit(withCursor(screen, field.row, field.col));
        return this.ok();
    }

    private nextInputField(screen: ScreenData, direction: 1 | -1): Field | null {
        const inputFields = screen.fields.filter((f) => f.is_input && !f.is_protected);
        if (inputFields.length === 0) return null;
        const position = screen.cursor_row * screen.cols + screen.cursor_col;
        const currentIndex = inputFields.findIndex((f) => {
            const start = f.row * screen.cols + f.col;
            return position >= start && position < start + f.length;
        });
        const base = currentIndex === -1 ? (direction === 1 ? -1 : 0) : currentIndex;
        const nextIndex = (base + direction + inputFields.length) % inputFields.length;
        return inputFields[nextIndex];
    }

    private eraseCharacter(screen: ScreenData, offsetDelta: number): SendResult {
        const targetOffset = screen.cursor_row * screen.cols + screen.cursor_col + offsetDelta;
        if (targetOffset < 0) return this.ok();

        const row = Math.floor(targetOffset / screen.cols);
        const col = targetOffset % screen.cols;
        const field = findInputFieldAt(screen, row, col);
        if (field === null) return { success: false, error: 'Cursor is not in an input field' };

        const fieldStart = field.row * screen.cols + field.col;
        const offset = targetOffset - fieldStart;
        const current = readFieldValue(screen, field);
        const next = current.slice(0, offset) + current.slice(offset + 1) + ' ';

        const written = writeFieldValue(screen, field, next);
        this.emit(withCursor(written, row, col));
        return this.ok();
    }

    private clampToField(field: Field, offset: number, cols: number): { row: number; col: number } {
        const fieldStart = field.row * cols + field.col;
        const last = fieldStart + field.length - 1;
        const clamped = Math.min(offset, last);
        return { row: Math.floor(clamped / cols), col: clamped % cols };
    }

    // --- Polling ---

    private startPolling(): void {
        if (this.pollIntervalMs <= 0) return;
        this.stopPolling();
        this.pollTimer = setInterval(() => {
            void this.poll();
        }, this.pollIntervalMs);
    }

    private stopPolling(): void {
        if (this.pollTimer !== undefined) {
            clearInterval(this.pollTimer);
            this.pollTimer = undefined;
        }
    }

    /** `version` is the only reliable change token — `timestamp` moves on every call. */
    private async poll(): Promise<void> {
        if (this.lightmanId === undefined || this.sourceId === undefined) return;
        try {
            const response = await this.client.get(this.lightmanId, [this.sourceId]);
            const source = this.selectSource(response);
            if (source === null) return;
            const version = unwrapScreen(source).version;
            if (version !== undefined && version === this.version) return;
            this.adoptResponse(response);
        } catch {
            // A failed poll is transient; the next tick retries.
        }
    }

    // --- Helpers ---

    private emit(screen: ScreenData): void {
        this.screen = screen;
        for (const listener of this.listeners) listener(screen);
    }

    private ok(): SendResult {
        const screen = this.screen;
        if (screen === null) return { success: true };
        return {
            success: true,
            cursor_row: screen.cursor_row,
            cursor_col: screen.cursor_col,
            content: screen.content,
            screen_signature: screen.screen_signature,
        };
    }

    private fail(e: unknown): SendResult {
        const message = e instanceof Error ? e.message : String(e);
        return { success: false, error: message };
    }
}
