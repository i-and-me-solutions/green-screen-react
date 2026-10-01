// Components
export { GreenScreenTerminal } from './components/GreenScreenTerminal';
export type { GreenScreenTerminalHandle, GreenScreenTerminalProps, TerminalHeaderState } from './components/GreenScreenTerminal';
export { InlineSignIn } from './components/InlineSignIn';
export type { InlineSignInProps } from './components/InlineSignIn';
export { TerminalBootLoader } from './components/TerminalBootLoader';
export type { TerminalBootLoaderProps } from './components/TerminalBootLoader';

// Icons
export { AlertTriangleIcon, KeyIcon, MinimizeIcon, RefreshIcon, TerminalIcon, WifiIcon, WifiOffIcon } from './components/Icons';

// Adapters
export { LightmanRouterClient } from './adapters/lightman/client';
export type { LightmanRouterClientOptions } from './adapters/lightman/client';
export type {
  LightmanChangedField,
  LightmanField,
  LightmanFieldKeyStrategy,
  LightmanInterface,
  LightmanScreen,
  LightmanSource,
  LightmanSourcesResponse,
  LightmanWritePayload,
  SourceRequestId
} from './adapters/lightman/types';
export { LightmanAdapter } from './adapters/LightmanAdapter';
export type { LightmanAdapterOptions } from './adapters/LightmanAdapter';
export { RestAdapter } from './adapters/RestAdapter';
export type { RestAdapterOptions } from './adapters/RestAdapter';
export type {
  ConnectConfig, ConnectionStatus, Field,
  FieldValue, ProtocolColorProfile, ProtocolProfile, ScreenData, SendResult, TerminalAdapter,
  TerminalProtocol
} from './adapters/types';
export { WebSocketAdapter } from './adapters/WebSocketAdapter';
export type { WebSocketAdapterOptions } from './adapters/WebSocketAdapter';

// Hooks
export { useAutoReconnect } from './hooks/useAutoReconnect';
export type { UseAutoReconnectOptions, UseAutoReconnectResult } from './hooks/useAutoReconnect';
export {
  useTerminalConnection, useTerminalInput, useTerminalScreen
} from './hooks/useTerminal';
export { useTerminalState } from './hooks/useTerminalState';
export type { UseTerminalStateOptions, UseTerminalStateResult } from './hooks/useTerminalState';

// Protocols
export { hp6530Profile } from './protocols/hp6530';
export { getProtocolProfile } from './protocols/registry';
export { tn3270Profile } from './protocols/tn3270';
export { tn5250Profile } from './protocols/tn5250';
export { vtProfile } from './protocols/vt';

// Utilities
export { isFieldEntry, positionToRowCol } from './utils/grid';
export { getRowColorClass, parseHeaderRow } from './utils/rendering';

