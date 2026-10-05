# Lightman Adapter Harness

Runs `GreenScreenTerminal` directly against the Lightman Router API, with no
connection screen: the session is opened on mount and the terminal is rendered
as soon as the first screen arrives.

## Running

```bash
npm install          # once, from the repository root
npm run dev:lightman # http://localhost:5174
```

The dev server proxies `/api/lightman/router` to the Lightman host, so the
browser stays same-origin and no CORS headers are required.

## Configuration

Copy `.env.example` to `.env` to change the target host.

| Variable | Default | Purpose |
| --- | --- | --- |
| `VITE_LIGHTMAN_HOST` | `192.168.88.99` | Lightman host the proxy forwards to |
| `VITE_LIGHTMAN_PORT` | `7042` | Router port |
| `VITE_LIGHTMAN_USER` | `lmn` | Default user for `LIGHTMAL.open` |
| `VITE_LIGHTMAN_UI_KEY` | `terminal` | Default UI key for `LIGHTMAL.open` |

A one-off host override needs no `.env` file:

```bash
VITE_LIGHTMAN_HOST=10.0.0.5 npm run dev:lightman
```

## Query parameters

| Parameter | Purpose |
| --- | --- |
| `user` | Overrides `VITE_LIGHTMAN_USER` |
| `uiKey` | Overrides `VITE_LIGHTMAN_UI_KEY` |
| `lightmanId` | Resumes an existing session via `LIGHTMAL.get` |
| `sourceId` | Binds to a specific source instead of the first terminal one |
| `fieldKeyStrategy` | `indexName` (default), `id` or `rpgName` |
| `poll` | Poll interval in ms for `LIGHTMAL.get`; `0` disables |

Example: `http://localhost:5174/?uiKey=terminal&fieldKeyStrategy=id&poll=1000`

## Debug panel

Below the terminal, every router round-trip is listed newest-first with its full
request and response JSON, alongside the active `lightman_id`, `source_id` and
field key strategy. Use it to confirm that typing produces no traffic and that a
single `LIGHTMAL.write` is sent per AID key.

## Troubleshooting

**Terminal stays empty, error banner shows a 5xx** — the host is unreachable.
Verify `VITE_LIGHTMAN_HOST`/`VITE_LIGHTMAN_PORT` and restart the dev server;
Vite reads env only at startup.

**Screen renders but input never reaches the host** — the write key scheme is
wrong. Retry with `?fieldKeyStrategy=id` and compare the request in the debug
panel against what the host accepts.

**Screen never updates on its own** — Lightman only answers requests. If the
host changes the screen without client input, enable polling with `?poll=1000`.
