'use client';

import type { TerminalAdapter } from '@i-and-me/green-screen-react';
import { GreenScreenTerminal } from '@i-and-me/green-screen-react';
import { useTranslations } from 'next-intl';
import { useTheme } from 'next-themes';
import { JSX, useEffect, useRef, useState } from 'react';
import { LegacyRouterLightmanClient } from '../../lib/LegacyRouterLightmanClient';
import { AnySource, ScreenData, SourceRequestId } from '../../lib/LightmanClient';
import { useAssistantContext } from './assistant-context';

export type LightmanTerminalProps = {
    user?: string;
    uiKey?: string;
    lightmanId?: string;
    contextKey?: string;
    onLightmanIdChange?: (lightmanId: string) => void;
    routerUrl?: string;
};

// UI Key for opening a regular terminal session
const TERMINAL_UI_KEY = 'terminal';

export default function LightmanTerminal({
    user = 'lmn',
    uiKey = TERMINAL_UI_KEY,
    lightmanId,
    contextKey = uiKey,
    onLightmanIdChange,
    routerUrl = '/api/lightman/router',
}: LightmanTerminalProps): JSX.Element {
    const t = useTranslations('Terminal.LightmanTerminal');
    const { resolvedTheme } = useTheme();
    const terminalThemeName = resolvedTheme === 'light' ? 'lightman-light' : 'lightman';
    const [sources, setSources] = useState<AnySource[] | undefined>(undefined);
    const [connectedBySource, setConnectedBySource] = useState<Record<SourceRequestId, boolean>>({});
    const [screenBySource, setScreenBySource] = useState<Record<SourceRequestId, ScreenData>>({});
    const [errorMessage, setErrorMessage] = useState<string>('');
    const hasInitialized = useRef(false);
    const { removeTerminalContext, setTerminalContext } = useAssistantContext();

    useEffect((): void | (() => void) => {
        for (const [sourceId, screen] of Object.entries(screenBySource)) {
            setTerminalContext(`${contextKey}-${sourceId}`, {
                connected: connectedBySource[Number(sourceId)] === true,
                lightmanId,
                screen,
                sourceId: Number(sourceId),
            });
        }
        return (): void => {
            for (const sourceId of Object.keys(screenBySource)) {
                removeTerminalContext(`${contextKey}-${sourceId}`);
            }
        };
    }, [connectedBySource, contextKey, lightmanId, removeTerminalContext, screenBySource, setTerminalContext]);

    function pushScreen(sourceId: SourceRequestId, screen: ScreenData | null): void {
        if (screen === null) {
            return;
        }
        setScreenBySource((prev: Record<SourceRequestId, ScreenData>): Record<SourceRequestId, ScreenData> => ({
            ...prev,
            [sourceId]: screen,
        }));
    }

    function createTerminalAdapter(source: AnySource): TerminalAdapter {
        return {
            getScreen: (): Awaited<ReturnType<TerminalAdapter['getScreen']>> =>
                source.localScreen,
            getStatus: (): Awaited<ReturnType<TerminalAdapter['getStatus']>> => ({
                connected: connectedBySource[source.sourceId] === true,
            }),
            sendText: async (text: string): Promise<Awaited<ReturnType<TerminalAdapter['sendText']>>> => {
                const result = await source.sendText(text);
                pushScreen(source.sourceId, source.localScreen);
                return result;
            },
            sendKey: async (key: string): Promise<Awaited<ReturnType<TerminalAdapter['sendKey']>>> => {
                const result = await source.sendKey(key);
                pushScreen(source.sourceId, source.localScreen);
                return result;
            },
            setCursor: async (row: number, col: number): Promise<Awaited<ReturnType<NonNullable<TerminalAdapter['setCursor']>>>> => {
                const result = await source.setCursor(row, col);
                pushScreen(source.sourceId, source.localScreen);
                return result;
            },
            connect: async (): Promise<Awaited<ReturnType<TerminalAdapter['connect']>>> => {
                const result = await source.connect();
                setConnectedBySource((prev: Record<SourceRequestId, boolean>): Record<SourceRequestId, boolean> => ({
                    ...prev,
                    [source.sourceId]: true,
                }));
                pushScreen(source.sourceId, source.localScreen);
                return result;
            },
            disconnect: async (): Promise<Awaited<ReturnType<TerminalAdapter['disconnect']>>> => {
                const result = await source.disconnect();
                setConnectedBySource((prev: Record<SourceRequestId, boolean>): Record<SourceRequestId, boolean> => ({
                    ...prev,
                    [source.sourceId]: false,
                }));
                return result;
            },
            reconnect: async (): Promise<Awaited<ReturnType<TerminalAdapter['reconnect']>>> => {
                try {
                    await source.disconnect();
                    const result = await source.connect();
                    setConnectedBySource((prev: Record<SourceRequestId, boolean>): Record<SourceRequestId, boolean> => ({
                        ...prev,
                        [source.sourceId]: true,
                    }));
                    pushScreen(source.sourceId, source.localScreen);
                    return result;
                } catch (error: unknown) {
                    setConnectedBySource((prev: Record<SourceRequestId, boolean>): Record<SourceRequestId, boolean> => ({
                        ...prev,
                        [source.sourceId]: false,
                    }));
                    throw error instanceof Error ? error : new Error(String(error));
                }
            },
        };
    }

    useEffect((): void => {
        if (hasInitialized.current) {
            return;
        }
        hasInitialized.current = true;

        const client = new LegacyRouterLightmanClient({ routerUrl });

        async function fetchSources(): Promise<void> {
            let fetchedSources: AnySource[];
            if (lightmanId !== undefined) {
                client.lightmanId = lightmanId;
                await client.get();
                fetchedSources = client.sources;
            } else {
                fetchedSources = await client.open(user, 'terminal');
                if (client.lightmanId !== undefined) {
                    onLightmanIdChange?.(client.lightmanId);
                }
            }
            const initialConnected: Record<SourceRequestId, boolean> = {};
            const initialScreens: Record<SourceRequestId, ScreenData> = {};
            for (const source of fetchedSources) {
                initialConnected[source.sourceId] = true;
                const screen = source.localScreen;
                if (screen !== null) {
                    initialScreens[source.sourceId] = screen;
                }
            }
            setSources(fetchedSources);
            setConnectedBySource(initialConnected);
            setScreenBySource(initialScreens);
        }

        fetchSources()
            .catch((_error: unknown): void => {
                setErrorMessage(t('sourceFetchError', { uiKey }));
            });
    }, [lightmanId, onLightmanIdChange, routerUrl, t, uiKey, user]);

    if (errorMessage.length > 0) {
        return <div>{errorMessage}</div>;
    }

    if (sources === undefined) {
        return (
            <main className="lightman-terminal-theme" aria-live="polite" aria-busy="true">
                <div className="gs-emulator-frame">
                    <div className="gs-emulator-titlebar">
                        <div className="gs-emulator-dots" aria-hidden="true">
                            <span className="gs-emulator-dot gs-emulator-dot--close" />
                            <span className="gs-emulator-dot gs-emulator-dot--min" />
                            <span className="gs-emulator-dot gs-emulator-dot--max" />
                        </div>
                        <span className="gs-emulator-title">{t('terminalTitle')}</span>
                        <div className="gs-emulator-status">
                            <span className="gs-emulator-status-dot gs-emulator-status-dot--loading" aria-hidden="true" />
                            <span>{t('connecting')}</span>
                        </div>
                    </div>
                    <div className="gs-emulator-body gs-emulator-body--loading">
                        <section className="source-loader-card" role="status" aria-label={t('loadingSources')}>
                            <span className="source-loader-ring" aria-hidden="true" />
                            <div>
                                <div className="source-loader-label">{t('sessionPreparing')}</div>
                                <p className="source-loader-text">{t('gatheringSources')}</p>
                            </div>
                        </section>
                    </div>
                </div>
            </main>
        );
    }

    return (
        <main className="lightman-terminal-theme">
            {sources.map((src: AnySource): JSX.Element => {
                if (src.kind !== 'terminal' && src.render === 'modernized') {
                    return <h1 key={src.sourceId}>{t('modernizedApplication')}</h1>;
                }

                const adapter = createTerminalAdapter(src);
                const isConnected = connectedBySource[src.sourceId] === true;
                const screenData = screenBySource[src.sourceId] ?? null;

                return (
                    <div key={src.sourceId} className="gs-emulator-frame">
                        <div className="gs-emulator-titlebar">
                            <div className="gs-emulator-dots" aria-hidden="true">
                                <span className="gs-emulator-dot gs-emulator-dot--close" />
                                <span className="gs-emulator-dot gs-emulator-dot--min" />
                                <span className="gs-emulator-dot gs-emulator-dot--max" />
                            </div>
                            <span className="gs-emulator-title">{t('terminalTitle')}</span>
                            <div className="gs-emulator-status">
                                <span
                                    className={`gs-emulator-status-dot${isConnected ? ' gs-emulator-status-dot--connected' : ''}`}
                                    aria-hidden="true"
                                />
                                <span>{isConnected ? t('connected') : t('disconnected')}</span>
                            </div>
                        </div>
                        <div className="gs-emulator-body">
                            <GreenScreenTerminal
                                adapter={adapter}
                                connectionStatus={{
                                    connected: isConnected,
                                    status: isConnected ? 'authenticated' : 'disconnected',
                                }}
                                pollInterval={0}
                                protocol="tn5250"
                                theme={terminalThemeName}
                                header={false}
                                screenData={screenData}
                                alwaysCursor={true}
                            />
                        </div>
                    </div>
                );
            })}
        </main>
    );
}
