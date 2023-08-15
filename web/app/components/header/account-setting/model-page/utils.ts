import { ValidatedStatus } from '../key-validator/declarations'
import { ProviderEnum } from './declarations'
import { validateModelProvider } from '@/service/common'

export const ConfigurableProviders = [ProviderEnum.azure_openai, ProviderEnum.replicate, ProviderEnum.huggingface_hub]

export const validateModelProviderFn = async (providerName: ProviderEnum, v: any) => {
  let body, url

  if (ConfigurableProviders.includes(providerName)) {
    const { model_name, model_type, ...config } = v
    body = {
      model_name,
      model_type,
      config,
    }
    url = `/workspaces/current/model-providers/${providerName}/models/validate`
  }
  else {
    body = {
      config: v,
    }
    url = `/workspaces/current/model-providers/${providerName}/validate`
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
