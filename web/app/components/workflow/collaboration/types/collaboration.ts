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
  type: 'mouse_move' | 'vars_and_features_update' | 'sync_request' | 'app_state_update' | 'app_meta_update' | 'mcp_server_update' | 'workflow_update' | 'comments_update' | 'node_panel_presence' | 'app_publish_update'
  userId: string
  data: any
  timestamp: number
}
