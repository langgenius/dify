export type CollaborationEvent = {
  type: string
  data: any
  timestamp: number
}

export type GraphUpdateEvent = {
  type: 'graph_update'
  data: Uint8Array
} & CollaborationEvent

export type CursorMoveEvent = {
  type: 'cursor_move'
  data: {
    x: number
    y: number
    userId: string
  }
} & CollaborationEvent

export type UserConnectEvent = {
  type: 'user_connect'
  data: {
    workflow_id: string
  }
} & CollaborationEvent

export type OnlineUsersEvent = {
  type: 'online_users'
  data: {
    users: Array<{
      user_id: string
      username: string
      avatar: string
      sid: string
    }>
  }
} & CollaborationEvent
