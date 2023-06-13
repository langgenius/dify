export enum AppType {
  'chat' = 'chat',
  'completion' = 'completion',
}

export type VariableInput = {
  key: string
  name: string
  value: string
}

/**
 * App modes
 */
export const AppModes = ['completion', 'chat'] as const
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
  label: string
  variable: string
  required: boolean
  max_length: number
}

export type SelectTypeFormItem = {
  label: string
  variable: string
  required: boolean
  options: string[]
}
/**
 * User Input Form Item
 */
export type UserInputFormItem = {
  'text-input': TextTypeFormItem
} | {
  'select': SelectTypeFormItem
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
}

/**
 * Model configuration. The backend type.
 */
export type ModelConfig = {
  opening_statement: string
  pre_prompt: string
  user_input_form: UserInputFormItem[]
  more_like_this: {
    enabled: boolean
  }
  suggested_questions_after_answer: {
    enabled: boolean
  }
  agent_mode: {
    enabled: boolean
    tools: ToolItem[]
  }
  model: {
    /** LLM provider, e.g., OPENAI */
    provider: string
    /** Model name, e.g, gpt-3.5.turbo */
    name: string
    /** Default Completion call parameters */
    completion_params: {
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
  }
}

export const LanguagesSupported = ['zh-Hans', 'en-US'] as const
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

  icon: string
  icon_background: string
}

/**
 * App
 */
export type App = {
  /** App ID */
  id: string
  /** Name */
  name: string

  /** Icon */
  icon: string
  /** Icon Background */
  icon_background: string

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
