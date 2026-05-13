/* eslint-disable erasable-syntax-only/enums, ts/no-explicit-any */
/* tslint:disable */
/*
 * ---------------------------------------------------------------
 * ## THIS FILE WAS GENERATED VIA SWAGGER-TYPESCRIPT-API        ##
 * ##                                                           ##
 * ## AUTHOR: acacode                                           ##
 * ## SOURCE: https://github.com/acacode/swagger-typescript-api ##
 * ---------------------------------------------------------------
 */

/** AppMode */
export enum AppMode {
  AdvancedChat = 'advanced-chat',
  AgentChat = 'agent-chat',
  Channel = 'channel',
  Chat = 'chat',
  Completion = 'completion',
  RagPipeline = 'rag-pipeline',
  Workflow = 'workflow',
}

/** AccountPayload */
export type AccountPayload = {
  /** Email */
  email: string
  /** Id */
  id: string
  /** Name */
  name: string
}

/** AccountResponse */
export type AccountResponse = {
  account?: AccountPayload
  /** Default Workspace Id */
  default_workspace_id?: string
  /** Subject Email */
  subject_email?: string
  /** Subject Issuer */
  subject_issuer?: string
  /** Subject Type */
  subject_type: string
  /**
   * Workspaces
   * @default []
   */
  workspaces?: WorkspacePayload[]
}

/** AppDescribeInfo */
export type AppDescribeInfo = {
  /** Author */
  author?: string
  /** Description */
  description?: string
  /** Id */
  id: string
  /**
   * Is Agent
   * @default false
   */
  is_agent?: boolean
  /** Mode */
  mode: string
  /** Name */
  name: string
  /** Service Api Enabled */
  service_api_enabled: boolean
  /**
   * Tags
   * @default []
   */
  tags?: TagItem[]
  /** Updated At */
  updated_at?: string
}

/**
 * AppDescribeQuery
 * `?fields=` allow-list for GET /apps/<id>/describe.
 *
 * Empty / omitted → all blocks. Unknown member → ValidationError → 422.
 */
export type AppDescribeQuery = {
  /** Fields */
  fields?: string[]
  /** Workspace Id */
  workspace_id?: string
}

/** AppDescribeResponse */
export type AppDescribeResponse = {
  info?: AppDescribeInfo
  /** Input Schema */
  input_schema?: Record<string, any>
  /** Parameters */
  parameters?: Record<string, any>
}

/** AppInfoResponse */
export type AppInfoResponse = {
  /** Author */
  author?: string
  /** Description */
  description?: string
  /** Id */
  id: string
  /** Mode */
  mode: string
  /** Name */
  name: string
  /**
   * Tags
   * @default []
   */
  tags?: TagItem[]
}

/**
 * AppListQuery
 * mode is a closed enum.
 */
export type AppListQuery = {
  /**
   * Limit
   * @min 1
   * @max 200
   * @default 20
   */
  limit?: number
  mode?: AppMode
  /** Name */
  name?: string
  /**
   * Page
   * @min 1
   * @default 1
   */
  page?: number
  /** Tag */
  tag?: string
  /** Workspace Id */
  workspace_id: string
}

/** AppListResponse */
export type AppListResponse = {
  /** Data */
  data: AppListRow[]
  /** Has More */
  has_more: boolean
  /** Limit */
  limit: number
  /** Page */
  page: number
  /** Total */
  total: number
}

/** AppListRow */
export type AppListRow = {
  /** Created By Name */
  created_by_name?: string
  /** Description */
  description?: string
  /** Id */
  id: string
  mode: AppMode
  /** Name */
  name: string
  /**
   * Tags
   * @default []
   */
  tags?: TagItem[]
  /** Updated At */
  updated_at?: string
  /** Workspace Id */
  workspace_id?: string
  /** Workspace Name */
  workspace_name?: string
}

/** AppRunRequest */
export type AppRunRequest = {
  /**
   * Auto Generate Name
   * @default true
   */
  auto_generate_name?: boolean
  /** Conversation Id */
  conversation_id?: string
  /** Files */
  files?: Record<string, any>[]
  /** Inputs */
  inputs: Record<string, any>
  /** Query */
  query?: string
  /** Response Mode */
  response_mode?: 'blocking' | 'streaming'
  /** Workflow Id */
  workflow_id?: string
  /** Workspace Id */
  workspace_id?: string
}

/** ChatMessageResponse */
export type ChatMessageResponse = {
  /** Answer */
  answer: string
  /** Conversation Id */
  conversation_id: string
  /** Created At */
  created_at: number
  /** Event */
  event: string
  /** Id */
  id: string
  /** Message Id */
  message_id: string
  metadata?: MessageMetadata
  /** Mode */
  mode: string
  /** Task Id */
  task_id: string
}

/** CompletionMessageResponse */
export type CompletionMessageResponse = {
  /** Answer */
  answer: string
  /** Created At */
  created_at: number
  /** Event */
  event: string
  /** Id */
  id: string
  /** Message Id */
  message_id: string
  metadata?: MessageMetadata
  /** Mode */
  mode: string
  /** Task Id */
  task_id: string
}

/** DeviceCodeRequest */
export type DeviceCodeRequest = {
  /** Client Id */
  client_id: string
  /** Device Label */
  device_label: string
}

/** DeviceCodeResponse */
export type DeviceCodeResponse = {
  /** Device Code */
  device_code: string
  /** Expires In */
  expires_in: number
  /** Interval */
  interval: number
  /** User Code */
  user_code: string
  /** Verification Uri */
  verification_uri: string
}

/** DeviceLookupQuery */
export type DeviceLookupQuery = {
  /** User Code */
  user_code: string
}

/** DeviceLookupResponse */
export type DeviceLookupResponse = {
  /** Client Id */
  client_id?: string
  /**
   * Expires In Remaining
   * @default 0
   */
  expires_in_remaining?: number
  /** Valid */
  valid: boolean
}

/** DeviceMutateRequest */
export type DeviceMutateRequest = {
  /** User Code */
  user_code: string
}

/** DeviceMutateResponse */
export type DeviceMutateResponse = {
  /** Status */
  status: string
}

/** DevicePollRequest */
export type DevicePollRequest = {
  /** Client Id */
  client_id: string
  /** Device Code */
  device_code: string
}

/** MessageMetadata */
export type MessageMetadata = {
  /**
   * Retriever Resources
   * @default []
   */
  retriever_resources?: Record<string, any>[]
  usage?: UsageInfo
}

/**
 * PermittedExternalAppsListQuery
 * Strict (extra='forbid').
 */
export type PermittedExternalAppsListQuery = {
  /**
   * Limit
   * @min 1
   * @max 200
   * @default 20
   */
  limit?: number
  mode?: AppMode
  /** Name */
  name?: string
  /**
   * Page
   * @min 1
   * @default 1
   */
  page?: number
}

/** PermittedExternalAppsListResponse */
export type PermittedExternalAppsListResponse = {
  /** Data */
  data: AppListRow[]
  /** Has More */
  has_more: boolean
  /** Limit */
  limit: number
  /** Page */
  page: number
  /** Total */
  total: number
}

/** RevokeResponse */
export type RevokeResponse = {
  /** Status */
  status: string
}

/** SessionListResponse */
export type SessionListResponse = {
  /** Data */
  data: SessionRow[]
  /** Has More */
  has_more: boolean
  /** Limit */
  limit: number
  /** Page */
  page: number
  /** Total */
  total: number
}

/** SessionRow */
export type SessionRow = {
  /** Client Id */
  client_id: string
  /** Created At */
  created_at?: string
  /** Device Label */
  device_label: string
  /** Expires At */
  expires_at?: string
  /** Id */
  id: string
  /** Last Used At */
  last_used_at?: string
  /** Prefix */
  prefix: string
}

/** TagItem */
export type TagItem = {
  /** Name */
  name: string
}

/** UsageInfo */
export type UsageInfo = {
  /**
   * Completion Tokens
   * @default 0
   */
  completion_tokens?: number
  /**
   * Prompt Tokens
   * @default 0
   */
  prompt_tokens?: number
  /**
   * Total Tokens
   * @default 0
   */
  total_tokens?: number
}

/** WorkflowRunData */
export type WorkflowRunData = {
  /** Created At */
  created_at?: number
  /** Elapsed Time */
  elapsed_time?: number
  /** Error */
  error?: string
  /** Finished At */
  finished_at?: number
  /** Id */
  id: string
  /** Outputs */
  outputs?: Record<string, any>
  /** Status */
  status: string
  /** Total Steps */
  total_steps?: number
  /** Total Tokens */
  total_tokens?: number
  /** Workflow Id */
  workflow_id: string
}

/** WorkflowRunResponse */
export type WorkflowRunResponse = {
  data: WorkflowRunData
  /**
   * Mode
   * @default "workflow"
   */
  mode?: 'workflow'
  /** Task Id */
  task_id: string
  /** Workflow Run Id */
  workflow_run_id: string
}

/** WorkspaceDetailResponse */
export type WorkspaceDetailResponse = {
  /** Created At */
  created_at?: string
  /** Current */
  current: boolean
  /** Id */
  id: string
  /** Name */
  name: string
  /** Role */
  role: string
  /** Status */
  status: string
}

/** WorkspaceListResponse */
export type WorkspaceListResponse = {
  /** Workspaces */
  workspaces: WorkspaceSummaryResponse[]
}

/** WorkspacePayload */
export type WorkspacePayload = {
  /** Id */
  id: string
  /** Name */
  name: string
  /** Role */
  role: string
}

/** WorkspaceSummaryResponse */
export type WorkspaceSummaryResponse = {
  /** Current */
  current: boolean
  /** Id */
  id: string
  /** Name */
  name: string
  /** Role */
  role: string
  /** Status */
  status: string
}
