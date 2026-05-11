export type OnlineUser = {
  user_id: string
  username: string
  avatar: string
  sid: string
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

type NodePanelPresenceInfo = NodePanelPresenceUser & {
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
  disconnectReason?: string
  error?: string
}

type CollaborationEventType
  = | 'mouse_move'
    | 'vars_and_features_update'
    | 'sync_request'
    | 'app_state_update'
    | 'app_meta_update'
    | 'mcp_server_update'
    | 'workflow_update'
    | 'comments_update'
    | 'node_panel_presence'
    | 'app_publish_update'
    | 'graph_resync_request'
    | 'workflow_restore_intent'
    | 'workflow_restore_complete'
    | 'workflow_history_action'

export type CollaborationUpdate = {
  type: CollaborationEventType
  userId: string
  data: Record<string, unknown>
  timestamp: number
}

export type RestoreIntentData = {
  versionId: string
  versionName?: string
  initiatorUserId: string
  initiatorName: string
}

export type RestoreCompleteData = {
  versionId: string
  success: boolean
  error?: string
}
