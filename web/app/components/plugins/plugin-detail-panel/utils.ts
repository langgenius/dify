import type {
  EndpointProviderConfigI18nResponse,
  EndpointProviderConfigResponse,
  ProviderConfigType,
} from '@dify/contracts/api/console/workspaces/types.gen'
import type { FormSchema } from '@/app/components/base/form/types'
import type { ToolCredential } from '@/app/components/tools/types'
import { FormTypeEnum } from '@/app/components/base/form/types'

type EndpointFormSchema = FormSchema & { variable: string }

const endpointConfigTypeToFormType = (
  type: ProviderConfigType | ToolCredential['type'],
): FormTypeEnum => {
  switch (type) {
    case 'app-selector':
      return FormTypeEnum.appSelector
    case 'array[tools]':
      return FormTypeEnum.multiToolSelector
    case 'boolean':
      return FormTypeEnum.boolean
    case 'model-selector':
      return FormTypeEnum.modelSelector
    case 'secret-input':
      return FormTypeEnum.secretInput
    case 'select':
      return FormTypeEnum.select
    case 'text-input':
    case 'string':
      return FormTypeEnum.textInput
    case 'number':
      return FormTypeEnum.textNumber
    case 'checkbox':
      return FormTypeEnum.checkbox
    default:
      return FormTypeEnum.textInput
  }
}

const normalizeEndpointI18n = (
  value: EndpointProviderConfigI18nResponse | null | undefined,
  fallback: string,
) => ({
  en_US: value?.en_US ?? fallback,
  zh_Hans: value?.zh_Hans ?? value?.en_US ?? fallback,
  ja_JP: value?.ja_JP ?? value?.en_US ?? fallback,
  pt_BR: value?.pt_BR ?? value?.en_US ?? fallback,
})

export const endpointPluginSettingsToFormSchemas = (
  settings: ToolCredential[],
): EndpointFormSchema[] => {
  return settings.map((setting) => ({
    type: endpointConfigTypeToFormType(setting.type),
    name: setting.name,
    variable: setting.name,
    label: setting.label,
    required: setting.required,
    default: setting.default,
    tooltip: setting.help ?? undefined,
    placeholder: setting.placeholder,
    options: setting.options,
    show_on: [],
  }))
}

export const endpointSettingsToFormSchemas = (
  settings: EndpointProviderConfigResponse[],
): EndpointFormSchema[] => {
  return settings.map((setting) => ({
    type: endpointConfigTypeToFormType(setting.type),
    name: setting.name,
    variable: setting.name,
    label: normalizeEndpointI18n(setting.label, setting.name),
    required: setting.required ?? false,
    multiple: setting.multiple,
    default: setting.default ?? undefined,
    tooltip: setting.help ? normalizeEndpointI18n(setting.help, setting.name) : undefined,
    placeholder: setting.placeholder
      ? normalizeEndpointI18n(setting.placeholder, setting.name)
      : undefined,
    options: setting.options?.map((option) => ({
      label: normalizeEndpointI18n(option.label, option.value),
      value: option.value,
    })),
    url: setting.url ?? undefined,
    scope: setting.scope ?? undefined,
    show_on: [],
  }))
}

export const NAME_FIELD: EndpointFormSchema = {
  type: FormTypeEnum.textInput,
  name: 'name',
  variable: 'name',
  label: {
    en_US: 'Endpoint Name',
    zh_Hans: '端点名称',
    ja_JP: 'エンドポイント名',
    pt_BR: 'Nome do ponto final',
  },
  placeholder: {
    en_US: 'Endpoint Name',
    zh_Hans: '端点名称',
    ja_JP: 'エンドポイント名',
    pt_BR: 'Nome do ponto final',
  },
  required: true,
  default: '',
}
