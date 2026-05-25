import type { CollectionType } from '@/app/components/tools/types'
import type { UploadFileSetting } from '@/app/components/workflow/types'
import type { Tag } from '@/contract/console/tags'
import type { LanguagesSupported } from '@/i18n-config/language'
import type { AccessMode } from '@/models/access-control'
import type { ExternalDataTool } from '@/models/common'
import type {
  RerankingModeEnum,
  WeightedScoreEnum,
} from '@/models/datasets'
import type { AnnotationReplyConfig, ChatPromptConfig, CompletionPromptConfig, DatasetConfigs, PromptMode } from '@/models/debug'

// Canonic Studio-level types re-exported from the studio-frontend package
export {
  Theme,
  ModelModeType,
  RETRIEVE_TYPE,
  RETRIEVE_METHOD,
  AppModeEnum,
  AppModes,
  AgentStrategy,
  Resolution,
  TransferMethod,
  TtsAutoPlay,
  ALLOW_FILE_EXTENSIONS,
  type PromptVariable,
  type UserInputFormItem,
  type CompletionParams,
  type Model,
  type AppIconType,
  type AppSSO,
  type VisionSettings,
  type ImageFile,
  type VisionFile,
} from '@dify/studio-frontend/types/app'

export type AgentTool = {
  provider_id: string
  provider_type: CollectionType
  provider_name: string
  tool_name: string
  tool_label: string
  tool_parameters: Record<string, any>
  enabled: boolean
  isDeleted?: boolean
  notAuthor?: boolean
  credential_id?: string
}

export type ToolItem = {
  dataset: {
    enabled: boolean
    id: string
  }
} | {
  'sensitive-word-avoidance': {
    enabled: boolean
    words: string[]
    canned_response: string
  }
} | AgentTool

export type ModelConfig = {
  opening_statement: string
  suggested_questions?: string[]
  pre_prompt: string
  prompt_type: PromptMode
  chat_prompt_config?: ChatPromptConfig | null
  completion_prompt_config?: CompletionPromptConfig | null
  user_input_form: UserInputFormItem[]
  dataset_query_variable?: string
  more_like_this: {
    enabled: boolean
  }
  suggested_questions_after_answer: {
    enabled: boolean
    model?: Model
    prompt?: string
  }
  speech_to_text: {
    enabled: boolean
  }
  text_to_speech: {
    enabled: boolean
    voice?: string
    language?: string
    autoPlay?: TtsAutoPlay
  }
  retriever_resource: {
    enabled: boolean
  }
  sensitive_word_avoidance: {
    enabled: boolean
  }
  annotation_reply?: AnnotationReplyConfig
  agent_mode: {
    enabled: boolean
    strategy?: AgentStrategy
    tools: ToolItem[]
  }
  external_data_tools?: ExternalDataTool[]
  model: Model
  dataset_configs: DatasetConfigs
  file_upload?: {
    image: VisionSettings
  } & UploadFileSetting
  files?: VisionFile[]
  system_parameters: {
    audio_file_size_limit: number
    file_size_limit: number
    image_file_size_limit: number
    video_file_size_limit: number
    workflow_file_upload_limit: number
  }
  created_at?: number
  updated_at?: number
}

export type Language = typeof LanguagesSupported[number]

/**
 * Web Application Configuration
 */
export type SiteConfig = {
  /** Application URL Identifier: `http://dify.app/{access_token}` */
  access_token: string
  /** Public Title */
  title: string
  /** Application Description will be shown in the Client  */
  description: string
  /**
   * Define the color in hex for different elements of the chatbot, such as:
   * The header, the button , etc.
   */
  chat_color_theme: string
  /** Invert the color of the theme set in chat_color_theme */
  chat_color_theme_inverted: boolean
  /** Author */
  author: string
  /** User Support Email Address */
  support_email: string
  /**
   * Default Language, e.g. zh-Hans, en-US
   * Use standard RFC 4646, see https://www.ruanyifeng.com/blog/2008/02/codes_for_language_names.html
   */
  default_language: Language
  /**  Custom Domain */
  customize_domain: string
  /** Theme */
  theme: string
  /** Custom Token strategy Whether Terminal Users can choose their OpenAI Key */
  customize_token_strategy: 'must' | 'allow' | 'not_allow'
  /** Is Prompt Public */
  prompt_public: boolean
  /** Web API and APP Base Domain Name */
  app_base_url: string
  /** Copyright */
  copyright: string
  /** Privacy Policy */
  privacy_policy: string
  /** Custom Disclaimer */
  custom_disclaimer: string

  icon_type: AppIconType | null
  icon: string
  icon_background: string | null
  icon_url: string | null

  show_workflow_steps: boolean
  use_icon_as_answer_icon: boolean
}

/**
 * App
 */
export type App = {
  /** App ID */
  id: string
  /** Name */
  name: string
  /** Description */
  description: string
  /** Author Name */
  author_name: string

  /**
   * Icon Type
   * @default 'emoji'
   */
  icon_type: AppIconType | null
  /** Icon, stores file ID if icon_type is 'image' */
  icon: string
  /** Icon Background, only available when icon_type is null or 'emoji' */
  icon_background: string | null
  /** Icon URL, only available when icon_type is 'image' */
  icon_url: string | null
  /** Whether to use app icon as answer icon */
  use_icon_as_answer_icon: boolean

  /** Mode */
  mode: AppModeEnum
  /** Enable web app */
  enable_site: boolean
  /** Enable web API */
  enable_api: boolean
  /** API requests per minute, default is 60 */
  api_rpm: number
  /** API requests per hour, default is 3600 */
  api_rph: number
  /** Whether it's a demo app */
  is_demo: boolean
  /** Model configuration */
  model_config: ModelConfig
  app_model_config: ModelConfig
  /** Timestamp of creation */
  created_at: number
  /** Timestamp of update */
  updated_at: number
  /** Web Application Configuration */
  site: SiteConfig
  /** api site url */
  api_base_url: string
  tags: Tag[]
  workflow?: {
    id: string
    created_at: number
    created_by?: string
    updated_at: number
    updated_by?: string
  }
  deleted_tools?: Array<{ id: string, tool_name: string }>
  /** access control */
  access_mode: AccessMode
  max_active_requests?: number | null
  /** whether workflow trigger has un-published draft */
  has_draft_trigger?: boolean
}

export type RetrievalConfig = {
  search_method: RETRIEVE_METHOD
  reranking_enable: boolean
  reranking_model: {
    reranking_provider_name: string
    reranking_model_name: string
  }
  top_k: number
  score_threshold_enabled: boolean
  score_threshold: number
  reranking_mode?: RerankingModeEnum
  weights?: {
    weight_type: WeightedScoreEnum
    vector_setting: {
      vector_weight: number
      embedding_provider_name: string
      embedding_model_name: string
    }
    keyword_setting: {
      keyword_weight: number
    }
  }
}
