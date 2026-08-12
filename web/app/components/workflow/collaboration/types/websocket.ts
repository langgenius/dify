export type WebSocketConfig = {
  token?: string
  transports?: string[]
  withCredentials?: boolean
}

type ConnectionInfo = {
  connected: boolean
  connecting: boolean
  socketId?: string
}

export type DebugInfo = {
  [appId: string]: ConnectionInfo
}
