import type { LightmanFieldKeyStrategy } from 'green-screen-react'
import { GreenScreenTerminal, LightmanAdapter } from 'green-screen-react'
import { useEffect, useMemo, useRef, useState } from 'react'

type RouterExchange = {
    at: string
    request: Record<string, unknown>
    response: unknown
}

const FIELD_KEY_STRATEGIES: LightmanFieldKeyStrategy[] = ['indexName', 'id', 'rpgName']

function isFieldKeyStrategy(value: string | null): value is LightmanFieldKeyStrategy {
    return value !== null && (FIELD_KEY_STRATEGIES as string[]).includes(value)
}

export default function App() {
    const params = useMemo(() => new URLSearchParams(window.location.search), [])
    const [connected, setConnected] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [exchanges, setExchanges] = useState<RouterExchange[]>([])
    const [showDebug, setShowDebug] = useState(true)
    const [showStatus, setShowStatus] = useState(true)
    const [lightmanId, setLightmanId] = useState<string | null>(null)
    const hasConnected = useRef(false)

    const strategyParam = params.get('fieldKeyStrategy')
    const pollParam = Number(params.get('poll') ?? '0')

    const adapter = useMemo(
        () =>
            new LightmanAdapter({
                uiKey: params.get('uiKey') ?? import.meta.env.VITE_LIGHTMAN_UI_KEY ?? 'terminal',
                user: params.get('user') ?? import.meta.env.VITE_LIGHTMAN_USER ?? 'lmn',
                lightmanId: params.get('lightmanId') ?? undefined,
                sourceId: params.get('sourceId') !== null ? Number(params.get('sourceId')) : undefined,
                fieldKeyStrategy: isFieldKeyStrategy(strategyParam) ? strategyParam : 'indexName',
                pollIntervalMs: Number.isFinite(pollParam) ? pollParam : 0,
                onLightmanIdChange: setLightmanId,
                onRequest: (request, response) => {
                    setExchanges((prev) => [{ at: new Date().toISOString(), request, response }, ...prev].slice(0, 20))
                },
            }),
        [params, pollParam, strategyParam],
    )

    useEffect(() => {
        // Guarded because StrictMode would otherwise open two host sessions.
        if (hasConnected.current) return
        hasConnected.current = true

        adapter.connect().then((result) => {
            if (result.success) {
                setConnected(true)
            } else {
                setError(result.error ?? 'Failed to open a Lightman session')
            }
        })

        return () => {
            adapter.dispose()
        }
    }, [adapter])

    return (
        <main className="lightman-page">
            <header className="lightman-header">
                <h1>Lightman Adapter Harness</h1>
                <span className={`lightman-badge${connected ? ' lightman-badge--on' : ''}`}>
                    {connected ? 'connected' : 'connecting…'}
                </span>
                <button
                    type="button"
                    className="lightman-status-toggle"
                    aria-pressed={showStatus}
                    onClick={() => setShowStatus((visible) => !visible)}
                >
                    Statusleiste {showStatus ? 'ausblenden' : 'anzeigen'}
                </button>
            </header>

            {error !== null && <p className="lightman-error">{error}</p>}

            <div className="lightman-terminal">
                <GreenScreenTerminal
                    adapter={adapter}
                    protocol="tn5250"
                    theme="modern"
                    pollInterval={0}
                    inlineSignIn={false}
                    bootLoader={false}
                    header={false}
                    showStatus={showStatus}
                    alwaysFocused
                    alwaysCursor
                    connectionStatus={{
                        connected,
                        status: connected ? 'authenticated' : 'connecting',
                    }}
                />
            </div>

            <section className="lightman-debug">
                <button type="button" onClick={() => setShowDebug((v) => !v)}>
                    {showDebug ? 'Hide' : 'Show'} router traffic ({exchanges.length})
                </button>
                {showDebug && (
                    <dl className="lightman-meta">
                        <dt>lightman_id</dt>
                        <dd>{lightmanId ?? '—'}</dd>
                        <dt>source_id</dt>
                        <dd>{adapter.activeSourceId ?? '—'}</dd>
                        <dt>fieldKeyStrategy</dt>
                        <dd>{isFieldKeyStrategy(strategyParam) ? strategyParam : 'indexName'}</dd>
                    </dl>
                )}
                {showDebug &&
                    exchanges.map((exchange) => (
                        <details key={exchange.at + String(exchange.request.action)}>
                            <summary>
                                {String(exchange.request.action)} <span>{exchange.at}</span>
                            </summary>
                            <pre>{JSON.stringify(exchange.request, null, 2)}</pre>
                            <pre>{JSON.stringify(exchange.response, null, 2)}</pre>
                        </details>
                    ))}
            </section>
        </main>
    )
}
