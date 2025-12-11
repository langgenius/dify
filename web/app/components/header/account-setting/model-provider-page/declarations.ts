import type { SchemaRoot } from '@/app/components/workflow/nodes/llm/types'

export type FormValue = Record<string, any>

export type TypeWithI18N<T = string> = {
  en_US: T
  zh_Hans: T
  [key: string]: T
}

export enum FormTypeEnum {
  textInput = 'text-input',
  textNumber = 'number-input',
  secretInput = 'secret-input',
  select = 'select',
  radio = 'radio',
  checkbox = 'checkbox',
  boolean = 'boolean',
  files = 'files',
  file = 'file',
  modelSelector = 'model-selector',
  toolSelector = 'tool-selector',
  multiToolSelector = 'array[tools]',
  appSelector = 'app-selector',
  any = 'any',
  object = 'object',
  array = 'array',
  dynamicSelect = 'dynamic-select',
}

export type FormOption = {
  label: TypeWithI18N
  value: string
  show_on: FormShowOnObject[]
  icon?: string
}

export enum ModelTypeEnum {
  textGeneration = 'llm',
  textEmbedding = 'text-embedding',
  rerank = 'rerank',
  speech2text = 'speech2text',
  moderation = 'moderation',
  tts = 'tts',
}

export const MODEL_TYPE_TEXT = {
  [ModelTypeEnum.textGeneration]: 'LLM',
  [ModelTypeEnum.textEmbedding]: 'Text Embedding',
  [ModelTypeEnum.rerank]: 'Rerank',
  [ModelTypeEnum.speech2text]: 'Speech2text',
  [ModelTypeEnum.moderation]: 'Moderation',
  [ModelTypeEnum.tts]: 'TTS',
}

export enum ConfigurationMethodEnum {
  predefinedModel = 'predefined-model',
  customizableModel = 'customizable-model',
  fetchFromRemote = 'fetch-from-remote',
}

export enum ModelFeatureEnum {
  toolCall = 'tool-call',
  multiToolCall = 'multi-tool-call',
  agentThought = 'agent-thought',
  streamToolCall = 'stream-tool-call',
  vision = 'vision',
  video = 'video',
  document = 'document',
  audio = 'audio',
  StructuredOutput = 'structured-output',
}

export enum ModelFeatureTextEnum {
  toolCall = 'Tool Call',
  multiToolCall = 'Multi Tool Call',
  agentThought = 'Agent Thought',
  vision = 'Vision',
  video = 'Video',
  document = 'Document',
  audio = 'Audio',
}

export enum ModelStatusEnum {
  active = 'active',
  noConfigure = 'no-configure',
  quotaExceeded = 'quota-exceeded',
  noPermission = 'no-permission',
  disabled = 'disabled',
  credentialRemoved = 'credential-removed',
}

export const MODEL_STATUS_TEXT: { [k: string]: TypeWithI18N } = {
  'no-configure': {
    en_US: 'No Configure',
    zh_Hans: '未配置凭据',
  },
  'quota-exceeded': {
    en_US: 'Quota Exceeded',
    zh_Hans: '额度不足',
  },
  'no-permission': {
    en_US: 'No Permission',
    zh_Hans: '无使用权限',
  },
}

export enum CustomConfigurationStatusEnum {
  active = 'active',
  noConfigure = 'no-configure',
}

export type FormShowOnObject = {
  variable: string
  value: string
}

export type CredentialFormSchemaBase = {
  name: string
  variable: string
  label: TypeWithI18N
  type: FormTypeEnum
  required: boolean
  default?: string
  tooltip?: TypeWithI18N
  show_on: FormShowOnObject[]
  url?: string
  scope?: string
  input_schema?: SchemaRoot
}

export type CredentialFormSchemaTextInput = CredentialFormSchemaBase & {
  max_length?: number;
  placeholder?: TypeWithI18N,
  template?: {
    enabled: boolean
  },
  auto_generate?: {
    type: string
  }
}
export type CredentialFormSchemaNumberInput = CredentialFormSchemaBase & { min?: number; max?: number; placeholder?: TypeWithI18N }
export type CredentialFormSchemaSelect = CredentialFormSchemaBase & { options: FormOption[]; placeholder?: TypeWithI18N }
export type CredentialFormSchemaRadio = CredentialFormSchemaBase & { options: FormOption[] }
export type CredentialFormSchemaSecretInput = CredentialFormSchemaBase & { placeholder?: TypeWithI18N }
export type CredentialFormSchema = CredentialFormSchemaTextInput | CredentialFormSchemaSelect | CredentialFormSchemaRadio | CredentialFormSchemaSecretInput

export type ModelItem = {
  model: string
  label: TypeWithI18N
  model_type: ModelTypeEnum
  features?: ModelFeatureEnum[]
  fetch_from: ConfigurationMethodEnum
  status: ModelStatusEnum
  model_properties: Record<string, string | number>
  load_balancing_enabled: boolean
  deprecated?: boolean
  has_invalid_load_balancing_configs?: boolean
}

export enum PreferredProviderTypeEnum {
  system = 'system',
  custom = 'custom',
}

export enum CurrentSystemQuotaTypeEnum {
  trial = 'trial',
  free = 'free',
  paid = 'paid',
}

export enum QuotaUnitEnum {
  times = 'times',
  tokens = 'tokens',
  credits = 'credits',
}

export type QuotaConfiguration = {
  quota_type: CurrentSystemQuotaTypeEnum
  quota_unit: QuotaUnitEnum
  quota_limit: number
  quota_used: number
  last_used: number
  is_valid: boolean
}

export type Credential = {
  credential_id: string
  credential_name?: string
  from_enterprise?: boolean
  not_allowed_to_use?: boolean
}

export type CustomModel = {
  model: string
  model_type: ModelTypeEnum
}

export type CustomModelCredential = CustomModel & {
  credentials?: Record<string, any>
  available_model_credentials?: Credential[]
  current_credential_id?: string
  current_credential_name?: string
}

export type CredentialWithModel = Credential & {
  model: string
  model_type: ModelTypeEnum
}

export type ModelProvider = {
  provider: string
  label: TypeWithI18N
  description?: TypeWithI18N
  help: {
    title: TypeWithI18N
    url: TypeWithI18N
  }
  icon_small: TypeWithI18N
  icon_small_dark?: TypeWithI18N
  icon_large: TypeWithI18N
  background?: string
  supported_model_types: ModelTypeEnum[]
  configurate_methods: ConfigurationMethodEnum[]
  provider_credential_schema: {
    credential_form_schemas: CredentialFormSchema[]
  }
  model_credential_schema: {
    model: {
      label: TypeWithI18N
      placeholder: TypeWithI18N
    }
    credential_form_schemas: CredentialFormSchema[]
  }
  preferred_provider_type: PreferredProviderTypeEnum
  custom_configuration: {
    status: CustomConfigurationStatusEnum
    current_credential_id?: string
    current_credential_name?: string
    available_credentials?: Credential[]
    custom_models?: CustomModelCredential[]
    can_added_models?: {
      model: string
      model_type: ModelTypeEnum
    }[]
  }
  system_configuration: {
    enabled: boolean
    current_quota_type: CurrentSystemQuotaTypeEnum
    quota_configurations: QuotaConfiguration[]
  }
  allow_custom_token?: boolean
}

export type Model = {
  provider: string
  icon_large: TypeWithI18N
  icon_small: TypeWithI18N
  icon_small_dark?: TypeWithI18N
  label: TypeWithI18N
  models: ModelItem[]
  status: ModelStatusEnum
}

export type DefaultModelResponse = {
  model: string
  model_type: ModelTypeEnum
  provider: {
    provider: string
    icon_large: TypeWithI18N
    icon_small: TypeWithI18N
  }
}

export type DefaultModel = {
  provider: string
  model: string
}

export type CustomConfigurationModelFixedFields = {
  __model_name: string
  __model_type: ModelTypeEnum
}

export type ModelParameterRule = {
  default?: number | string | boolean | string[]
  help?: TypeWithI18N
  label: TypeWithI18N
  min?: number
  max?: number
  name: string
  precision?: number
  required: false
  type: string
  use_template?: string
  options?: string[]
  tagPlaceholder?: TypeWithI18N
}

export type ModelLoadBalancingConfigEntry = {
  /** model balancing config entry id */
  id?: string
  /** is config entry enabled */
  enabled?: boolean
  /** config entry name */
  name: string
  /** model balancing credential */
  credentials: Record<string, string | undefined | boolean>
  /** is config entry currently removed from Round-robin queue */
  in_cooldown?: boolean
  /** cooldown time (in seconds) */
  ttl?: number
  credential_id?: string
}

export type ModelLoadBalancingConfig = {
  enabled: boolean
  configs: ModelLoadBalancingConfigEntry[]
}

export type ProviderCredential = {
  credentials: Record<string, any>
  name: string
  credential_id: string
}

export type ModelCredential = {
  credentials: Record<string, any>
  load_balancing: ModelLoadBalancingConfig
  available_credentials: Credential[]
  current_credential_id?: string
  current_credential_name?: string
}

export enum ModelModalModeEnum {
  configProviderCredential = 'config-provider-credential',
  configCustomModel = 'config-custom-model',
  addCustomModelToModelList = 'add-custom-model-to-model-list',
  configModelCredential = 'config-model-credential',
}
