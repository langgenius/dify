import type {
  CodeBasedExtensionItem,
  ExternalDataTool,
} from '@/models/common'
import { LanguagesSupported } from '@/i18n-config/language'

const systemTypes = ['api'] as const

type Provider = {
  key: string
  name: string
  form_schema?: CodeBasedExtensionItem['form_schema']
}

type Translate = (key: string, options?: Record<string, unknown>) => string

type BuildProvidersParams = {
  codeBasedExtensionList?: {
    data: CodeBasedExtensionItem[]
  }
  locale: string
  t: Translate
}

type ValidationParams = {
  currentProvider?: Provider
  locale: string
  localeData: ExternalDataTool
  t: Translate
}

export const buildProviders = ({
  codeBasedExtensionList,
  locale,
  t,
}: BuildProvidersParams): Provider[] => {
  return [
    {
      key: 'api',
      name: t('apiBasedExtension.selector.title', { ns: 'common' }),
    },
    ...(codeBasedExtensionList
      ? codeBasedExtensionList.data.map(item => ({
          key: item.name,
          name: locale === LanguagesSupported[1] ? item.label['zh-Hans'] : item.label['en-US'],
          form_schema: item.form_schema,
        }))
      : []),
  ]
}

export const getProviderDefaultConfig = (type: string, providers: Provider[]) => {
  const currentProvider = providers.find(provider => provider.key === type)
  if (systemTypes.includes(type as typeof systemTypes[number]) || !currentProvider?.form_schema)
    return undefined

  return currentProvider.form_schema.reduce<Record<string, string>>((prev, next) => {
    prev[next.variable] = next.default
    return prev
  }, {})
}

export const formatExternalDataTool = (
  originData: ExternalDataTool,
  currentProvider: Provider | undefined,
  isEdit: boolean,
) => {
  const { type, config } = originData
  const params: Record<string, string | undefined> = {}

  if (type === 'api')
    params.api_based_extension_id = config?.api_based_extension_id

  if (!systemTypes.includes(type as typeof systemTypes[number]) && currentProvider?.form_schema) {
    currentProvider.form_schema.forEach((form) => {
      params[form.variable] = config?.[form.variable]
    })
  }

  return {
    ...originData,
    type,
    enabled: isEdit ? originData.enabled : true,
    config: params,
  }
}

export const getValidationError = ({
  currentProvider,
  locale,
  localeData,
  t,
}: ValidationParams) => {
  if (!localeData.type) {
    return t('errorMessage.valueOfVarRequired', { ns: 'appDebug', key: t('feature.tools.modal.toolType.title', { ns: 'appDebug' }) })
  }

  if (!localeData.label) {
    return t('errorMessage.valueOfVarRequired', { ns: 'appDebug', key: t('feature.tools.modal.name.title', { ns: 'appDebug' }) })
  }

  if (!localeData.variable) {
    return t('errorMessage.valueOfVarRequired', { ns: 'appDebug', key: t('feature.tools.modal.variableName.title', { ns: 'appDebug' }) })
  }

  if (!/^[a-z_]\w{0,29}$/i.test(localeData.variable)) {
    return t('varKeyError.notValid', { ns: 'appDebug', key: t('feature.tools.modal.variableName.title', { ns: 'appDebug' }) })
  }

  if (localeData.type === 'api' && !localeData.config?.api_based_extension_id) {
    return t('errorMessage.valueOfVarRequired', { ns: 'appDebug', key: locale === LanguagesSupported[1] ? 'API 扩展' : 'API Extension' })
  }

  if (!systemTypes.includes(localeData.type as typeof systemTypes[number]) && currentProvider?.form_schema) {
    for (let i = 0; i < currentProvider.form_schema.length; i++) {
      const form = currentProvider.form_schema[i]
      if (!localeData.config?.[form!.variable] && form!.required) {
        return t('errorMessage.valueOfVarRequired', { ns: 'appDebug', key: locale === LanguagesSupported[1] ? form!.label['zh-Hans'] : form!.label['en-US'] })
      }
    }
  }

  return null
}
