# green-screen-react

Multi-protocol legacy terminal React component. Connects to **TN5250** (IBM i / AS/400), **TN3270** (z/OS mainframe), **VT220** (OpenVMS, Unix), and **HP 6530** (NonStop) hosts.

> **v1.9.0**: added a terminal status bar with cursor position and host indicators, plus the `showStatus` prop to toggle it. Optimistic keyboard-lock feedback now yields to incoming screen snapshots even when screen text is unchanged.

> **v1.8.0**: lightman adapter added for the Lightman Router API.

> **v1.7.1**: added the `alwaysCursor` prop for rendering the cursor on any row, including rows outside detected input fields. The terminal now documents the current React package release and its cursor behavior.
>
> **v1.2.0**: per-field MDT state, `readMdt()` for cheap post-write verification, pluggable session store with `session.lost`/`session.resumed` lifecycle events, lower-level sign-on primitives. Python integrators can use the [`green-screen-client`](https://pypi.org/project/green-screen-client/) PyPI package.

## Install

```bash
npm install green-screen-react green-screen-proxy
```

## Quick Start

Start the proxy (separate terminal):

```bash
npx green-screen-proxy
```

Or start it programmatically from your app:

```typescript
import { createProxy } from 'green-screen-proxy';
await createProxy({ port: 3001 });
```

Render the component:

```tsx
import { GreenScreenTerminal } from 'green-screen-react';
import 'green-screen-react/styles.css';

function App() {
  return <GreenScreenTerminal />;
}
```

Connects to `localhost:3001` automatically. Use the sign-in form to connect to a real host.

## Adapters

### WebSocketAdapter (recommended)

Real-time bidirectional WebSocket. Works with both the Node.js proxy and the Cloudflare Worker.

```tsx
import { WebSocketAdapter } from 'green-screen-react';

// Local proxy (default)
const adapter = new WebSocketAdapter({ workerUrl: 'http://localhost:3001' });

// Cloudflare Worker
const adapter = new WebSocketAdapter({
  workerUrl: 'https://green-screen-worker.your-subdomain.workers.dev'
});

<GreenScreenTerminal adapter={adapter} />
```

### RestAdapter

For backends that expose a REST API:

```tsx
import { RestAdapter } from 'green-screen-react';

const adapter = new RestAdapter({
  baseUrl: 'https://your-server.com/api/terminal',
  headers: { Authorization: 'Bearer your-token' },
});
```

### LightmanAdapter

For the Lightman Router API, which exchanges whole screens over a single JSON
endpoint instead of a per-keystroke channel.

```tsx
import { LightmanAdapter } from 'green-screen-react';

const adapter = new LightmanAdapter({
  routerUrl: '/api/lightman/router',
  uiKey: 'terminal',
  user: 'lmn',
});

<GreenScreenTerminal
  adapter={adapter}
  protocol="tn5250"
  pollInterval={0}
  inlineSignIn={false}
/>
```

| Option | Default | Purpose |
| --- | --- | --- |
| `routerUrl` | `/api/lightman/router` | Router endpoint |
| `uiKey` | `'terminal'` | UI key for `LIGHTMAL.open` |
| `user` | – | User for `LIGHTMAL.open` |
| `lightmanId` | – | Resumes a session via `LIGHTMAL.get` instead of opening one |
| `sourceId` | first terminal source | Binds the adapter to one source |
| `fieldKeyStrategy` | `'indexName'` | Which field property keys a write's `data` object |
| `pollIntervalMs` | `0` | Polls `LIGHTMAL.get` for host-driven changes |
| `headers` | – | Extra request headers |
| `fetchImpl` | `globalThis.fetch` | Injectable transport, for tests |
| `onLightmanIdChange` | – | Receives the session id |
| `onRequest` | – | Observes every router round-trip |

Typing is applied to a local screen buffer; only an AID key (`ENTER`, `F1`–`F24`)
triggers a `LIGHTMAL.write` carrying the modified fields. Updates are pushed
through `onScreen`, so mount with `pollInterval={0}`. Sources reported as
`modernizedUI` are rendered read-only.

See [docs/lightman-adapter.md](../../docs/lightman-adapter.md) for the field
mapping, key handling and open questions.

### Custom Adapter

Implement `TerminalAdapter` to connect to any backend:

```typescript
import type { TerminalAdapter } from 'green-screen-react';

class MyAdapter implements TerminalAdapter {
  async getScreen() { /* ... */ }
  async getStatus() { /* ... */ }
  async sendText(text: string) { /* ... */ }
  async sendKey(key: string) { /* ... */ }
  async setCursor?(row: number, col: number) { /* ... */ }
  async readMdt?(modifiedOnly?: boolean) { /* ... */ }  // v1.2.0
  async connect(config?) { /* ... */ }
  async disconnect() { /* ... */ }
  async reconnect() { /* ... */ }
}
```

## v1.2.0 features

### Post-write verification with `readMdt()`

Instead of diffing the entire screen after a batch of writes, ask the proxy which fields actually captured input:

```tsx
import { WebSocketAdapter } from 'green-screen-react';

const adapter = new WebSocketAdapter({ workerUrl: 'http://localhost:3001' });

// ... after typing into several fields ...
const modified = await adapter.readMdt();       // only fields with MDT bit set
const all = await adapter.readMdt(false);       // all input fields

for (const f of modified) {
  console.log(`row ${f.row} col ${f.col}: "${f.value}"`);
}
```

`readMdt` is optional on the `TerminalAdapter` contract — protocols without a per-field modified concept (VT, HP6530) return `[]`.

### Session lifecycle events

`WebSocketAdapter` now exposes hooks for session-level transitions. Use them to prompt reconnect UX or surface a clean "session expired" state without string-matching errors:

```tsx
const adapter = new WebSocketAdapter({ workerUrl: 'http://localhost:3001' });

adapter.onSessionLost((sessionId, status) => {
  console.log('lost:', sessionId, status.error);
  // show "Session expired, click to reconnect" UI
});

adapter.onSessionResumed((sessionId) => {
  console.log('reattached:', sessionId);
});
```

On page reload, reattach to a session that survived the refresh:

```tsx
const sessionId = localStorage.getItem('tn5250-session-id');
if (sessionId) {
  await adapter.reattach(sessionId);
}
```

The proxy keeps the TCP connection alive across WebSocket drops within its idle timeout — `reattach` reconnects the WS and replays the current screen.

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `adapter` | `TerminalAdapter` | auto | Backend adapter |
| `protocol` | `'tn5250' \| 'tn3270' \| 'vt' \| 'hp6530'` | `'tn5250'` | Terminal protocol |
| `inlineSignIn` | `boolean` | `true` | Show sign-in form when disconnected |
| `defaultProtocol` | `TerminalProtocol` | `'tn5250'` | Pre-selected protocol in sign-in |
| `readOnly` | `boolean` | `false` | Disable keyboard input |
| `pollInterval` | `number` | `2000` | Screen polling interval (ms) |
| `autoReconnect` | `boolean` | `true` | Auto-reconnect on disconnect |
| `autoConnect` | `boolean` | `true` | **v1.3.0** — auto-create a `WebSocketAdapter` when no `adapter`/`baseUrl`/`workerUrl` is supplied. Set `false` to defer connection until you provide one. |
| `theme` | `'modern' \| 'classic'` | `'modern'` | **v1.3.0** — built-in visual theme preset (applied as `gs-theme-*` on the terminal root). |
| `header` | `ReactNode \| ((state) => ReactNode) \| false` | default | **v1.3.0** — fully pluggable header. Pass a node, a render function receiving terminal state, or `false` to hide. |
| `persistFocus` | `boolean` | `true` | **v1.3.0** — steer keyboard focus back to the terminal when focus is lost to non-form elements. |
| `alwaysFocused` | `boolean` | `false` | **v1.3.0** — aggressively reclaim focus; disables click-outside unfocus. Useful for full-page embeds. |
| `alwaysCursor` | `boolean` | `false` | **v1.7.1** — render the cursor on any row, not only inside detected input fields. Useful when the host screen uses cursor positions outside input fields. |
| `embedded` | `boolean` | `false` | Compact embedded mode |
| `showHeader` | `boolean` | `true` | Show header bar |
| `showStatus` | `boolean` | `true` | Show the status bar below the terminal screen |
| `bootLoader` | `ReactNode \| false` | default | Custom boot loader |
| `onSignIn` | `(config) => void` | - | Sign-in callback |
| `onScreenChange` | `(screen) => void` | - | Screen change callback |
| `bootLoaderReady` | `boolean` | - | Explicit boot-loader dismissal (overrides default "dismiss on first screen"). |
| `headerRight` | `ReactNode` | - | Custom content in the header's right slot. |
| `statusActions` | `ReactNode` | - | Custom buttons rendered after connection status groups (e.g. disconnect button). |
| `className` | `string` | - | CSS class |
| `style` | `CSSProperties` | - | Inline styles |

## Theming

```css
:root {
  --terminal-green: #10b981;
  --terminal-white: #FFFFFF;
  --terminal-blue: #7B93FF;
  --terminal-bg: #000000;
  --terminal-card-bg: #0e1422;
  --terminal-card-border: #1e293b;
  --terminal-header-bg: #090e1a;
  --terminal-font: 'JetBrains Mono', 'Courier New', monospace;
}
```

## License

MIT
