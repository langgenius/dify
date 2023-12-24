export type FormValue = Record<string, any>

export type TypeWithI18N<T = string> = {
  'en_US': T
  'zh_Hans': T
}

export enum FormTypeEnum {
  textInput = 'text-input',
  secretInput = 'secret-input',
  select = 'select',
  radio = 'radio',
}

export type FormOption = {
  label: TypeWithI18N
  value: string
  show_on: FormShowOnObject[]
}

export enum ModelTypeEnum {
  textGeneration = 'llm',
  textEmbedding = 'text-embedding',
  rerank = 'rerank',
  speech2text = 'speech2text',
  moderation = 'moderation',
}

export enum ConfigurateMethodEnum {
  predefinedModel = 'predefined-model',
  customizableModel = 'customizable-model',
  fetchFromRemote = 'fetch-from-remote',
}

export enum ModelFeatureEnum {
  toolCall = 'tool-call',
  multiToolCall = 'multi-tool-call',
  agentThought = 'agent_thought',
  vision = 'vision',
}

export enum ModelStatusEnum {
  active = 'active',
  noConfigure = 'no-configure',
  quotaExceeded = 'quota-exceeded',
  noPermission = 'no-permission',
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
  variable: string
  label: TypeWithI18N
  type: FormTypeEnum
  required: boolean
  default?: string
  show_on: FormShowOnObject[]
}

export type CredentialFormSchemaTextInput = CredentialFormSchemaBase & { max_length?: number; placeholder?: TypeWithI18N }
export type CredentialFormSchemaSelect = CredentialFormSchemaBase & { options: FormOption[] }
export type CredentialFormSchemaRadio = CredentialFormSchemaBase & { options: FormOption[] }
export type CredentialFormSchemaSecretInput = CredentialFormSchemaBase & { placeholder?: TypeWithI18N }
export type CredentialFormSchema = CredentialFormSchemaTextInput | CredentialFormSchemaSelect | CredentialFormSchemaRadio | CredentialFormSchemaSecretInput

export type ModelItem = {
  model: string
  label: TypeWithI18N
  model_type: ModelTypeEnum
  features: ModelFeatureEnum[]
  fetch_from: ConfigurateMethodEnum
  status: ModelStatusEnum
  model_properties: Record<string, string | number>
  deprecated?: boolean
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
}

export type QuotaConfiguration = {
  quota_type: CurrentSystemQuotaTypeEnum
  quota_unit: QuotaUnitEnum
  quota_limit: number
  quota_used: number
  last_used: number
  is_valid: boolean
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
  icon_large: TypeWithI18N
  background?: string
  supported_model_types: ModelTypeEnum[]
  configurate_methods: ConfigurateMethodEnum[]
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
  }
  system_configuration: {
    enabled: boolean
    current_quota_type: CurrentSystemQuotaTypeEnum
    quota_configurations: QuotaConfiguration[]
  }
}

export type Model = {
  provider: string
  icon_large: TypeWithI18N
  icon_small: TypeWithI18N
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

export type CustomConfigrationModelFixedFields = {
  __model_name: string
  __model_type: ModelTypeEnum
}
