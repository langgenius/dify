export type CollaborationEvent<TData = unknown> = {
  type: string
  data: TData
  timestamp: number
}

export type GraphUpdateEvent = {
  type: 'graph_update'
} & CollaborationEvent<Uint8Array>

export type CursorMoveEvent = {
  type: 'cursor_move'
} & CollaborationEvent<{
  x: number
  y: number
  userId: string
}>

export type UserConnectEvent = {
  type: 'user_connect'
} & CollaborationEvent<{
  workflow_id: string
}>

export type OnlineUsersEvent = {
  type: 'online_users'
} & CollaborationEvent<{
  users: Array<{
    user_id: string
    username: string
    avatar: string
    sid: string
  }>
}>
