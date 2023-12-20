import { ValidatedStatus } from '../key-validator/declarations'
import type { FormValue } from './declarations'
import { ModelTypeEnum } from './declarations'
import {
  deleteModelProvider,
  setModelProvider,
  validateModelProvider,
} from '@/service/common'

export const languageMaps = {
  'en': 'en_US',
  'zh-Hans': 'zh_Hans',
} as {
  'en': 'en_US'
  'zh-Hans': 'zh_Hans'
}

export const DEFAULT_BACKGROUND_COLOR = '#F3F4F6'

type validateModelProviderBody = {
  model?: string
  model_type?: ModelTypeEnum
  credentials: FormValue
}
export const validateCredentials = async (predefined: boolean, provider: string, v: validateModelProviderBody) => {
  let body, url

  if (predefined) {
    const { credentials } = v
    body = {
      credentials,
    }
    url = `/workspaces/current/model-providers/${provider}/credentials/validate`
  }
  else {
    const { model, model_type, credentials } = v
    body = {
      model,
      model_type,
      credentials,
    }
    url = `/workspaces/current/model-providers/${provider}/models/credentials/validate`
  }
  try {
    const res = await validateModelProvider({ url, body })
    if (res.result === 'success')
      return Promise.resolve({ status: ValidatedStatus.Success })
    else
      return Promise.resolve({ status: ValidatedStatus.Error, message: res.error })
  }
  catch (e: any) {
    return Promise.resolve({ status: ValidatedStatus.Error, message: e.message })
  }
}

export const saveCredentials = async (predefined: boolean, provider: string, v: validateModelProviderBody) => {
  let body, url

  if (predefined) {
    const { credentials } = v
    body = {
      credentials,
    }
    url = `/workspaces/current/model-providers/${provider}`
  }
  else {
    const { model, model_type, credentials } = v
    body = {
      model,
      model_type,
      credentials,
    }
    url = `/workspaces/current/model-providers/${provider}/models`
  }

  return setModelProvider({ url, body })
}

export const removeCredentials = async (predefined: boolean, provider: string, v?: Pick<validateModelProviderBody, 'model' | 'model_type'>) => {
  let url = ''
  let body

  if (predefined) {
    url = `/workspaces/current/model-providers/${provider}`
  }
  else {
    if (v) {
      const { model, model_type } = v
      body = {
        model,
        model_type,
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
