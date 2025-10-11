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

export type NodePanelPresenceUser = {
  userId: string
  username: string
  avatar?: string | null
}

export type NodePanelPresenceInfo = NodePanelPresenceUser & {
  clientId: string
  timestamp: number
}

export type NodePanelPresenceMap = Record<string, Record<string, NodePanelPresenceInfo>>

export type CollaborationState = {
  appId: string
  isConnected: boolean
  onlineUsers: OnlineUser[]
  cursors: Record<string, CursorPosition>
  nodePanelPresence: NodePanelPresenceMap
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
