export type ProviderType = 'system' | 'custom'

export type ProviderName = keyof ProviderFixedMap | keyof ProviderConfigurableMap

export type ProviderFixedMap = {
  'openai': {
    openai_api_key: string
    openai_api_base: string
    openai_organization: string
  }
  'anthropic': {
    anthropic_api_key: string
    anthropic_api_url: string
  }
  'minimax': {
    minimax_group_id: string
    minimax_api_key: string
  }
  'tongyi': {
    dashscope_api_key: string
  }
  'chatglm': {
    api_base: string
  }
}

export type ProviderConfigurableMap = {
  'azure_openai': {
    openai_api_key: string
    openai_api_base: string
  }
  'huggingface_hub': {
    huggingfacehub_api_type: string
    huggingfacehub_api_token: string
    huggingfacehub_task: string
    huggingfacehub_endpoint_url: string
  }
  'replicate': {
    replicate_api_token: string
    model_version: string
  }
}

export type ProviderSystem = {
  quota_type: 'trail' | 'paid'
  quota_unit: 'times' | 'tokens'
  quota_limit: number
  quota_used: number
  last_used: number
}

export type ProviderModelFlexibility = 'fixed' | 'configurable'

export type Model<T extends keyof ProviderConfigurableMap> = {
  model_name: string
  model_type: string
  config: ProviderConfigurableMap[T]
  is_valid: boolean
}

export type I18NMap = {
  'en-US': string
  'zh-Hans': string
}

export type ProviderFieldMap = {
  provider: {}
  model: {
    list_show_as: string
  }
}

export type FormMap = {
  text: {
    place_holder: I18NMap
    is_obfuscated: boolean
  }
  radio: {
    options: {
      key: string
      label: I18NMap
    }[]
  }
}

export type Field<T extends keyof ProviderFieldMap> = {
  [F in keyof FormMap]: {
    type: F
    key: string
    is_required: boolean
    toggle_enabled: boolean
    help: I18NMap | null
  } & FormMap[F] & ProviderFieldMap[T]
}[keyof FormMap]

export type Form = {
  [T in keyof ProviderFieldMap]: {
    type: T
    title: I18NMap
    link: {
      href: string
      label: I18NMap
    }
    fields: Field<T>[]
  }
}[keyof ProviderFieldMap]

export type ProviderTypeMap = {
  'custom': { form: Form }
  'system': ProviderSystem
}
export type Provider<T extends ProviderName> = {
  [P in keyof ProviderTypeMap]: {
    provider_name: T
    provider_type: P
    config: T extends keyof ProviderFixedMap ? ProviderFixedMap[T] : null
    models: T extends keyof ProviderConfigurableMap ? Model<T>[] : null
  } & ProviderTypeMap[P]
}[keyof ProviderTypeMap]

export type Providers = {
  [k in ProviderName]: {
    preferred_provider_type: ProviderType
    model_flexibility: ProviderModelFlexibility
    providers: k extends ProviderName ? Provider<k>[] : null
  }
}
