import type { Edge, Node } from '../../types'

export type OnlineUser = {
  user_id: string
  username: string
  avatar: string
  sid: string
}

export type WorkflowOnlineUsers = {
  workflow_id: string
  users: OnlineUser[]
}

export type OnlineUserListResponse = {
  data: WorkflowOnlineUsers[]
}

export type CursorPosition = {
  x: number
  y: number
  userId: string
  timestamp: number
}

export type CollaborationState = {
  appId: string
  isConnected: boolean
  onlineUsers: OnlineUser[]
  cursors: Record<string, CursorPosition>
}

export type GraphSyncData = {
  nodes: Node[]
  edges: Edge[]
}

export type CollaborationUpdate = {
  type: 'mouseMove' | 'graphUpdate' | 'userJoin' | 'userLeave'
  userId: string
  data: any
  timestamp: number
}
