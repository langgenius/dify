import { ValidatedStatus } from '../key-validator/declarations'
import { validateModelProvider, validateModelProviderModel } from '@/service/common'

export const validateModelProviderFn = async (providerName: string, body: any) => {
  try {
    const res = await validateModelProvider({
      url: `/workspaces/current/model-providers/${providerName}/validate`,
      body,
    })
    if (res.result === 'success')
      return Promise.resolve({ status: ValidatedStatus.Success })
    else
      return Promise.resolve({ status: ValidatedStatus.Error, message: res.error })
  }
  catch (e: any) {
    return Promise.resolve({ status: ValidatedStatus.Error, message: e.message })
  }
}

export const validateModelProviderModelFn = async (providerName: string, body: any) => {
  try {
    const { model_name, model_type, ...config } = body
    const res = await validateModelProviderModel({
      url: `/workspaces/current/model-providers/${providerName}/models/validate`,
      body: {
        model_name,
        model_type,
        config,
      },
    })
    if (res.result === 'success')
      return Promise.resolve({ status: ValidatedStatus.Success })
    else
      return Promise.resolve({ status: ValidatedStatus.Error, message: res.error })
  }
  catch (e: any) {
    return Promise.resolve({ status: ValidatedStatus.Error, message: e.message })
  }
}
