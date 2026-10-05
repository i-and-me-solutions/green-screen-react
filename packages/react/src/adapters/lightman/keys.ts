/**
 * Key handling for the Lightman adapter.
 *
 * `GreenScreenTerminal` emits uppercase key names (`'ENTER'`, `'TAB'`, `'F3'`,
 * `'PAGEUP'`, …). Only AID keys reach the host; everything else moves the
 * cursor or edits the local buffer and never hits the network.
 *
 * `'ENTER'` and `'F1'`–`'F24'` are confirmed against the live router. The
 * remaining AID names are passed through unchanged as an assumption — adjust
 * `FUNCTION_KEY_OVERRIDES` once the router's vocabulary is known.
 */

const AID_KEYS = new Set<string>([
    'ENTER', 'CLEAR', 'PAGEUP', 'PAGEDOWN', 'ROLLUP', 'ROLLDOWN',
    'PA1', 'PA2', 'PA3', 'HELP', 'PRINT', 'ATTN', 'SYSREQ',
]);

const F_KEY = /^F([1-9]|1[0-9]|2[0-4])$/;

/** Key names whose Lightman spelling differs from the green-screen name. */
const FUNCTION_KEY_OVERRIDES: Record<string, string> = {};

/** True when the key submits the screen to the host. */
export function isAidKey(key: string): boolean {
    return AID_KEYS.has(key) || F_KEY.test(key);
}

/** Translates a green-screen key name into the router's `functionKey` value. */
export function toFunctionKey(key: string): string {
    return FUNCTION_KEY_OVERRIDES[key] ?? key;
}

/** Cursor movement applied locally, expressed as a delta in rows and columns. */
const CURSOR_DELTAS: Record<string, { row: number; col: number }> = {
    UP: { row: -1, col: 0 },
    DOWN: { row: 1, col: 0 },
    LEFT: { row: 0, col: -1 },
    RIGHT: { row: 0, col: 1 },
};

/** New cursor position for an arrow key, wrapping at the screen edges. */
export function moveCursor(
    key: string,
    row: number,
    col: number,
    rows: number,
    cols: number,
): { row: number; col: number } | null {
    const delta = CURSOR_DELTAS[key];
    if (delta === undefined) return null;

    let nextRow = row + delta.row;
    let nextCol = col + delta.col;
    if (nextCol < 0) {
        nextCol = cols - 1;
        nextRow -= 1;
    } else if (nextCol >= cols) {
        nextCol = 0;
        nextRow += 1;
    }
    return { row: ((nextRow % rows) + rows) % rows, col: nextCol };
}
