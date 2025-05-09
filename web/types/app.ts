import type { AnnotationReplyConfig, ChatPromptConfig, CompletionPromptConfig, DatasetConfigs, PromptMode } from '@/models/debug'
import type { CollectionType } from '@/app/components/tools/types'
import type { LanguagesSupported } from '@/i18n/language'
import type { Tag } from '@/app/components/base/tag-management/constant'
import type {
  RerankingModeEnum,
  WeightedScoreEnum,
} from '@/models/datasets'
import type { UploadFileSetting } from '@/app/components/workflow/types'

export enum Theme {
  light = 'light',
  dark = 'dark',
  system = 'system',
}

export enum ProviderType {
  openai = 'openai',
  anthropic = 'anthropic',
  azure_openai = 'azure_openai',
  replicate = 'replicate',
  huggingface_hub = 'huggingface_hub',
  minimax = 'minimax',
  tongyi = 'tongyi',
  spark = 'spark',
}

export enum AppType {
  chat = 'chat',
  completion = 'completion',
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

export type VariableInput = {
  key: string
  name: string
  value: string
}

/**
 * App modes
 */
export const AppModes = ['advanced-chat', 'agent-chat', 'chat', 'completion', 'workflow'] as const
export type AppMode = typeof AppModes[number]

/**
 * Variable type
 */
export const VariableTypes = ['string', 'number', 'select'] as const
export type VariableType = typeof VariableTypes[number]

/**
 * Prompt variable parameter
 */
export type PromptVariable = {
  /** Variable key */
  key: string
  /** Variable name */
  name: string
  /** Type */
  type: VariableType
  required: boolean
  /** Enumeration of single-selection drop-down values */
  options?: string[]
  max_length?: number
}

export type TextTypeFormItem = {
  default: string
  label: string
  variable: string
  required: boolean
  max_length: number
}

export type SelectTypeFormItem = {
  default: string
  label: string
  variable: string
  required: boolean
  options: string[]
}

export type ParagraphTypeFormItem = {
  default: string
  label: string
  variable: string
  required: boolean
}
/**
 * User Input Form Item
 */
export type UserInputFormItem = {
  'text-input': TextTypeFormItem
} | {
  select: SelectTypeFormItem
} | {
  paragraph: TextTypeFormItem
}

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

export enum AgentStrategy {
  functionCall = 'function_call',
  react = 'react',
}

export type CompletionParams = {
  /** Maximum number of tokens in the answer message returned by Completion */
  max_tokens: number
  /**
   * A number between 0 and 2.
   * The larger the number, the more random the result;
   * otherwise, the more deterministic.
   * When in use, choose either `temperature` or `top_p`.
   * Default is 1.
   */
  temperature: number
  /**
   * Represents the proportion of probability mass samples to take,
   * e.g., 0.1 means taking the top 10% probability mass samples.
   * The determinism between the samples is basically consistent.
   * Among these results, the `top_p` probability mass results are taken.
   * When in use, choose either `temperature` or `top_p`.
   * Default is 1.
   */
  top_p: number
  /** When enabled, the Completion Text will concatenate the Prompt content together and return it. */
  echo: boolean
  /**
   * Specify up to 4 to automatically stop generating before the text specified in `stop`.
   * Suitable for use in chat mode.
   * For example, specify "Q" and "A",
   * and provide some Q&A examples as context,
   * and the model will give out in Q&A format and stop generating before Q&A.
   */
  stop: string[]
  /**
   * A number between -2.0 and 2.0.
   * The larger the value, the less the model will repeat topics and the more it will provide new topics.
   */
  presence_penalty: number
  /**
   * A number between -2.0 and 2.0.
   * A lower setting will make the model appear less cultured,
   * always repeating expressions.
   * The difference between `frequency_penalty` and `presence_penalty`
   * is that `frequency_penalty` penalizes a word based on its frequency in the training data,
   * while `presence_penalty` penalizes a word based on its occurrence in the input text.
   */
  frequency_penalty: number
}
/**
 * Model configuration. The backend type.
 */
export type Model = {
  /** LLM provider, e.g., OPENAI */
  provider: string
  /** Model name, e.g, gpt-3.5.turbo */
  name: string
  mode: ModelModeType
  /** Default Completion call parameters */
  completion_params: CompletionParams
}

export type ModelConfig = {
  opening_statement: string
  suggested_questions?: string[]
  pre_prompt: string
  prompt_type: PromptMode
  chat_prompt_config: ChatPromptConfig | {}
  completion_prompt_config: CompletionPromptConfig | {}
  user_input_form: UserInputFormItem[]
  dataset_query_variable?: string
  more_like_this: {
    enabled?: boolean
  }
  suggested_questions_after_answer: {
    enabled: boolean
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
  model: Model
  dataset_configs: DatasetConfigs
  file_upload?: {
    image: VisionSettings
  } & UploadFileSetting
  files?: VisionFile[]
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
  /** Define the color in hex for different elements of the chatbot, such as:
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

export type AppIconType = 'image' | 'emoji'

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
  author_name: string;

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
  mode: AppMode
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
}

export type AppSSO = {
  enable_sso: boolean
}

/**
 * App Template
 */
export type AppTemplate = {
  /** Name */
  name: string
  /** Description */
  description: string
  /** Mode */
  mode: AppMode
  /** Model */
  model_config: ModelConfig
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
