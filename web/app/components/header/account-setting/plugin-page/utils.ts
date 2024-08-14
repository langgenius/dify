import { ValidatedStatus } from '../key-validator/declarations'
import { updatePluginProviderAIKey, validatePluginProviderKey } from '@/service/common'

export const validatePluginKey = async (pluginType: string, body: any) => {
  try {
    const res = await validatePluginProviderKey({
      url: `/workspaces/current/tool-providers/${pluginType}/credentials-validate`,
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

export const updatePluginKey = async (pluginType: string, body: any) => {
  try {
    const res = await updatePluginProviderAIKey({
      url: `/workspaces/current/tool-providers/${pluginType}/credentials`,
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
