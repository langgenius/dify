export type WebSocketConfig = {
  url?: string
  token?: string
  transports?: string[]
  withCredentials?: boolean
}

export type ConnectionInfo = {
  connected: boolean
  connecting: boolean
  socketId?: string
}

export type DebugInfo = {
  [appId: string]: ConnectionInfo
}
