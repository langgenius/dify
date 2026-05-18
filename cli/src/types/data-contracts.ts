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
  account?: AccountPayload | null
  /** Default Workspace Id */
  default_workspace_id?: string | null
  /** Subject Email */
  subject_email?: string | null
  /** Subject Issuer */
  subject_issuer?: string | null
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
  author?: string | null
  /** Description */
  description?: string | null
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
  updated_at?: string | null
}

/**
 * AppDescribeQuery
 * `?fields=` allow-list for GET /apps/<id>/describe.
 *
 * Empty / omitted → all blocks. Unknown member → ValidationError → 422.
 */
export type AppDescribeQuery = {
  /**
   * Fields
   * @uniqueItems true
   */
  fields?: string[] | null
  /** Workspace Id */
  workspace_id?: string | null
}

/** AppDescribeResponse */
export type AppDescribeResponse = {
  info?: AppDescribeInfo | null
  /** Input Schema */
  input_schema?: Record<string, any> | null
  /** Parameters */
  parameters?: Record<string, any> | null
}

/** AppInfoResponse */
export type AppInfoResponse = {
  /** Author */
  author?: string | null
  /** Description */
  description?: string | null
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
  mode?: AppMode | null
  /**
   * Name
   * @maxLength 200
   */
  name?: string | null
  /**
   * Page
   * @min 1
   * @default 1
   */
  page?: number
  /**
   * Tag
   * @maxLength 100
   */
  tag?: string | null
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
  created_by_name?: string | null
  /** Description */
  description?: string | null
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
  updated_at?: string | null
  /** Workspace Id */
  workspace_id?: string | null
  /** Workspace Name */
  workspace_name?: string | null
}

/** AppRunRequest */
export type AppRunRequest = {
  /**
   * Auto Generate Name
   * @default true
   */
  auto_generate_name?: boolean
  /** Conversation Id */
  conversation_id?: string | null
  /** Files */
  files?: Record<string, any>[] | null
  /** Inputs */
  inputs: Record<string, any>
  /** Query */
  query?: string | null
  /** Workflow Id */
  workflow_id?: string | null
  /** Workspace Id */
  workspace_id?: string | null
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
  client_id?: string | null
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

/** HumanInputFormSubmitPayload */
export type HumanInputFormSubmitPayload = {
  /** Action */
  action: string
  /** Inputs */
  inputs: Record<string, JsonValue>
}

export type JsonValue = any

/** MessageMetadata */
export type MessageMetadata = {
  /**
   * Retriever Resources
   * @default []
   */
  retriever_resources?: Record<string, any>[]
  usage?: UsageInfo | null
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
  mode?: AppMode | null
  /**
   * Name
   * @maxLength 200
   */
  name?: string | null
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

/**
 * ServerVersionResponse
 * Meta endpoint payload for `GET /openapi/v1/_version` — no auth required.
 */
export type ServerVersionResponse = {
  /** Edition */
  edition: 'CLOUD' | 'SELF_HOSTED'
  /** Version */
  version: string
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
  created_at?: string | null
  /** Device Label */
  device_label: string
  /** Expires At */
  expires_at?: string | null
  /** Id */
  id: string
  /** Last Used At */
  last_used_at?: string | null
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
  created_at?: number | null
  /** Elapsed Time */
  elapsed_time?: number | null
  /** Error */
  error?: string | null
  /** Finished At */
  finished_at?: number | null
  /** Id */
  id: string
  /** Outputs */
  outputs?: Record<string, any>
  /** Status */
  status: string
  /** Total Steps */
  total_steps?: number | null
  /** Total Tokens */
  total_tokens?: number | null
  /** Workflow Id */
  workflow_id: string
}

/** WorkspaceDetailResponse */
export type WorkspaceDetailResponse = {
  /** Created At */
  created_at?: string | null
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
