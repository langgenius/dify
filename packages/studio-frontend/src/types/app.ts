/**
 * Studio application types — the canonical home for app-level enums and
 * shape types shared between studio-frontend and web.
 *
 * These types have zero @/web dependencies and can be imported safely from
 * any workspace package.  Types that depend on web-specific models
 * (ModelConfig, App, SiteConfig, etc.) stay in web/types/app.ts for now.
 */

// ── Enums ──────────────────────────────────────────────────────────────────

export enum Theme {
  light = 'light',
  dark = 'dark',
  system = 'system',
}

export enum ModelModeType {
  chat = 'chat',
  completion = 'completion',
  unset = '',
}

export enum RETRIEVE_TYPE {
  oneWay = 'single',
  multiWay = 'multiple',
}

export enum RETRIEVE_METHOD {
  semantic = 'semantic_search',
  fullText = 'full_text_search',
  hybrid = 'hybrid_search',
  invertedIndex = 'invertedIndex',
  keywordSearch = 'keyword_search',
}

export enum AppModeEnum {
  COMPLETION = 'completion',
  WORKFLOW = 'workflow',
  CHAT = 'chat',
  ADVANCED_CHAT = 'advanced-chat',
  AGENT_CHAT = 'agent-chat',
}

export const AppModes = [
  AppModeEnum.COMPLETION,
  AppModeEnum.WORKFLOW,
  AppModeEnum.CHAT,
  AppModeEnum.ADVANCED_CHAT,
  AppModeEnum.AGENT_CHAT,
] as const

export enum AgentStrategy {
  functionCall = 'function_call',
  react = 'react',
}

export enum Resolution {
  low = 'low',
  high = 'high',
}

export enum TransferMethod {
  all = 'all',
  local_file = 'local_file',
  remote_url = 'remote_url',
}

export enum TtsAutoPlay {
  enabled = 'enabled',
  disabled = 'disabled',
}

export const ALLOW_FILE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp', 'gif']

// ── Prompt / form types ────────────────────────────────────────────────────

type VariableType = 'string' | 'number' | 'select'

export type PromptVariable = {
  key: string
  name: string
  type: VariableType
  required: boolean
  options?: string[]
  max_length?: number
}

type TextTypeFormItem = {
  default: string
  label: string
  variable: string
  required: boolean
  max_length: number
  hide: boolean
}

type SelectTypeFormItem = {
  default: string
  label: string
  variable: string
  required: boolean
  options: string[]
  hide: boolean
}

export type UserInputFormItem =
  | { 'text-input': TextTypeFormItem }
  | { select: SelectTypeFormItem }
  | { paragraph: TextTypeFormItem }

// ── Model types ─────────────────────────────────────────────────────────────

export type CompletionParams = {
  max_tokens: number
  temperature: number
  top_p: number
  echo: boolean
  stop: string[]
  presence_penalty: number
  frequency_penalty: number
}

export type Model = {
  provider: string
  name: string
  mode: ModelModeType
  completion_params: CompletionParams
}

// ── Misc lightweight shapes ─────────────────────────────────────────────────

export type AppIconType = 'image' | 'emoji' | 'link'

export type AppSSO = {
  enable_sso: boolean
}

export type VisionSettings = {
  enabled: boolean
  number_limits: number
  detail: Resolution
  transfer_methods: TransferMethod[]
  image_file_size_limit?: number | string
}

export type ImageFile = {
  type: TransferMethod
  _id: string
  fileId: string
  file?: File
  progress: number
  url: string
  base64Url?: string
  deleted?: boolean
}

export type VisionFile = {
  id?: string
  type: string
  transfer_method: TransferMethod
  url: string
  upload_file_id: string
  belongs_to?: string
}
