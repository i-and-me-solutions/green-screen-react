import type {
    LightmanSourcesResponse,
    LightmanUIModuleListResponse,
    LightmanWritePayload,
    SourceRequestId,
} from './types';

/** Minimal `fetch` surface so callers can inject a stub in tests. */
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** Observer for every router round-trip, used by the demo's debug panel. */
export type LightmanRequestListener = (
    request: Record<string, unknown>,
    response: unknown,
) => void;

export interface LightmanRouterClientOptions {
    /** Router endpoint. Defaults to the dev-proxy path `/api/lightman/router`. */
    routerUrl?: string;
    /** Extra headers merged into every request (e.g. Authorization). */
    headers?: Record<string, string>;
    /** Overrides `globalThis.fetch`. */
    fetchImpl?: FetchLike;
    /** Called after every successful round-trip. */
    onRequest?: LightmanRequestListener;
}

const DEFAULT_ROUTER_URL = '/api/lightman/router';

/**
 * Transport for the Lightman Router API.
 *
 * Every action is a POST of `{ action, ...payload }` to a single endpoint:
 * - `LIGHTMAL.open`            → `{ lightman_id, sources }`
 * - `LIGHTMAL.get`             → same envelope, refreshed
 * - `LIGHTMAL.write`           → same envelope, after applying input
 * - `LIGHTMAL.getUIModuleList` → available UI modules for a user
 *
 * This class is stateless; session state lives in `LightmanAdapter`.
 */
export class LightmanRouterClient {
    private routerUrl: string;
    private headers: Record<string, string>;
    private fetchImpl: FetchLike;
    private onRequest?: LightmanRequestListener;

    constructor(options: LightmanRouterClientOptions = {}) {
        this.routerUrl = options.routerUrl || DEFAULT_ROUTER_URL;
        this.headers = options.headers || {};
        this.fetchImpl = options.fetchImpl || ((input, init) => fetch(input, init));
        this.onRequest = options.onRequest;
    }

    private async post<T>(action: string, payload: Record<string, unknown>): Promise<T> {
        const body = { action, ...payload };
        const response = await this.fetchImpl(this.routerUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...this.headers },
            body: JSON.stringify(body),
        });

        if (!response.ok) {
            throw new Error(`Lightman ${action} failed: HTTP ${response.status}`);
        }

        const json = (await response.json()) as T;
        this.onRequest?.(body, json);
        return json;
    }

    /** Opens a session for a UI context and returns its sources. */
    open(uiKey: string, user?: string): Promise<LightmanSourcesResponse> {
        const payload: Record<string, unknown> = { ui_key: uiKey };
        if (user !== undefined) payload.user = user;
        return this.post<LightmanSourcesResponse>('LIGHTMAL.open', payload);
    }

    /** Re-reads the current state of the given sources. */
    get(lightmanId: string, sources: SourceRequestId[]): Promise<LightmanSourcesResponse> {
        return this.post<LightmanSourcesResponse>('LIGHTMAL.get', { lightman_id: lightmanId, sources });
    }

    /** Applies field input and an optional function key, returning the new state. */
    write(
        lightmanId: string,
        sources: Record<string, LightmanWritePayload>,
    ): Promise<LightmanSourcesResponse> {
        return this.post<LightmanSourcesResponse>('LIGHTMAL.write', { lightman_id: lightmanId, sources });
    }

    /** Lists the UI modules available to a user. */
    getUIModuleList(user: string): Promise<LightmanUIModuleListResponse> {
        return this.post<LightmanUIModuleListResponse>('LIGHTMAL.getUIModuleList', { user });
    }
}
