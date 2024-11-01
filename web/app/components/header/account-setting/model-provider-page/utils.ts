import { ValidatedStatus } from '../key-validator/declarations'
import type {
  CredentialFormSchemaRadio,
  CredentialFormSchemaTextInput,
  FormValue,
  ModelLoadBalancingConfig,
} from './declarations'
import {
  ConfigurationMethodEnum,
  FormTypeEnum,
  MODEL_TYPE_TEXT,
  ModelTypeEnum,
} from './declarations'
import {
  deleteModelProvider,
  setModelProvider,
  validateModelLoadBalancingCredentials,
  validateModelProvider,
} from '@/service/common'

export const MODEL_PROVIDER_QUOTA_GET_PAID = ['anthropic', 'openai', 'azure_openai']

export const DEFAULT_BACKGROUND_COLOR = '#F3F4F6'

export const isNullOrUndefined = (value: any) => {
  return value === undefined || value === null
}

export const validateCredentials = async (predefined: boolean, provider: string, v: FormValue) => {
  let body, url

  if (predefined) {
    body = {
      credentials: v,
    }
    url = `/workspaces/current/model-providers/${provider}/credentials/validate`
  }
  else {
    const { __model_name, __model_type, ...credentials } = v
    body = {
      model: __model_name,
      model_type: __model_type,
      credentials,
    }
    url = `/workspaces/current/model-providers/${provider}/models/credentials/validate`
  }
  try {
    const res = await validateModelProvider({ url, body })
    if (res.result === 'success')
      return Promise.resolve({ status: ValidatedStatus.Success })
    else
      return Promise.resolve({ status: ValidatedStatus.Error, message: res.error || 'error' })
  }
  catch (e: any) {
    return Promise.resolve({ status: ValidatedStatus.Error, message: e.message })
  }
}

export const validateLoadBalancingCredentials = async (predefined: boolean, provider: string, v: FormValue, id?: string): Promise<{
  status: ValidatedStatus
  message?: string
}> => {
  const { __model_name, __model_type, ...credentials } = v
  try {
    const res = await validateModelLoadBalancingCredentials({
      url: `/workspaces/current/model-providers/${provider}/models/load-balancing-configs/${id ? `${id}/` : ''}credentials-validate`,
      body: {
        model: __model_name,
        model_type: __model_type,
        credentials,
      },
    })
    if (res.result === 'success')
      return Promise.resolve({ status: ValidatedStatus.Success })
    else
      return Promise.resolve({ status: ValidatedStatus.Error, message: res.error || 'error' })
  }
  catch (e: any) {
    return Promise.resolve({ status: ValidatedStatus.Error, message: e.message })
  }
}

export const saveCredentials = async (predefined: boolean, provider: string, v: FormValue, loadBalancing?: ModelLoadBalancingConfig) => {
  let body, url

  if (predefined) {
    body = {
      config_from: ConfigurationMethodEnum.predefinedModel,
      credentials: v,
      load_balancing: loadBalancing,
    }
    url = `/workspaces/current/model-providers/${provider}`
  }
  else {
    const { __model_name, __model_type, ...credentials } = v
    body = {
      model: __model_name,
      model_type: __model_type,
      credentials,
      load_balancing: loadBalancing,
    }
    url = `/workspaces/current/model-providers/${provider}/models`
  }

  return setModelProvider({ url, body })
}

export const savePredefinedLoadBalancingConfig = async (provider: string, v: FormValue, loadBalancing?: ModelLoadBalancingConfig) => {
  const { __model_name, __model_type, ...credentials } = v
  const body = {
    config_from: ConfigurationMethodEnum.predefinedModel,
    model: __model_name,
    model_type: __model_type,
    credentials,
    load_balancing: loadBalancing,
  }
  const url = `/workspaces/current/model-providers/${provider}/models`

  return setModelProvider({ url, body })
}

export const removeCredentials = async (predefined: boolean, provider: string, v: FormValue) => {
  let url = ''
  let body

  if (predefined) {
    url = `/workspaces/current/model-providers/${provider}`
  }
  else {
    if (v) {
      const { __model_name, __model_type } = v
      body = {
        model: __model_name,
        model_type: __model_type,
      }
      url = `/workspaces/current/model-providers/${provider}/models`
    }
  }

  return deleteModelProvider({ url, body })
}

export const sizeFormat = (size: number) => {
  const remainder = Math.floor(size / 1000)
  if (remainder < 1)
    return `${size}`
  else
    return `${remainder}K`
}

export const modelTypeFormat = (modelType: ModelTypeEnum) => {
  if (modelType === ModelTypeEnum.textEmbedding)
    return 'TEXT EMBEDDING'

  return modelType.toLocaleUpperCase()
}

export const genModelTypeFormSchema = (modelTypes: ModelTypeEnum[]) => {
  return {
    type: FormTypeEnum.radio,
    label: {
      zh_Hans: '模型类型',
      en_US: 'Model Type',
    },
    variable: '__model_type',
    default: modelTypes[0],
    required: true,
    show_on: [],
    options: modelTypes.map((modelType: ModelTypeEnum) => {
      return {
        value: modelType,
        label: {
          zh_Hans: MODEL_TYPE_TEXT[modelType],
          en_US: MODEL_TYPE_TEXT[modelType],
        },
        show_on: [],
      }
    }),
  } as CredentialFormSchemaRadio
}

export const genModelNameFormSchema = (model?: Pick<CredentialFormSchemaTextInput, 'label' | 'placeholder'>) => {
  return {
    type: FormTypeEnum.textInput,
    label: model?.label || {
      zh_Hans: '模型名称',
      en_US: 'Model Name',
    },
    variable: '__model_name',
    required: true,
    show_on: [],
    placeholder: model?.placeholder || {
      zh_Hans: '请输入模型名称',
      en_US: 'Please enter model name',
    },
  } as CredentialFormSchemaTextInput
}
