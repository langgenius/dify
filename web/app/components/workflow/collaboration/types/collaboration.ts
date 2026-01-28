import type { Viewport } from 'reactflow'
import type { ConversationVariable, Edge, EnvironmentVariable, Node } from '../../types'
import type { Features } from '@/app/components/base/features/types'

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

export type CollaborationEventType
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
    | 'graph_view_active'
    | 'skill_file_active'
    | 'skill_file_saved'
    | 'skill_cursor'
    | 'skill_sync_request'
    | 'skill_resync_request'
    | 'graph_resync_request'
    | 'workflow_restore_request'
    | 'workflow_restore_intent'
    | 'workflow_restore_complete'

export type CollaborationUpdate = {
  type: CollaborationEventType
  userId: string
  data: Record<string, unknown>
  timestamp: number
}

export type RestoreRequestData = {
  versionId: string
  versionName?: string
  initiatorUserId: string
  initiatorName: string
  graphData: {
    nodes: Node[]
    edges: Edge[]
    viewport?: Viewport
  }
  features?: Features
  environmentVariables?: EnvironmentVariable[]
  conversationVariables?: ConversationVariable[]
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
