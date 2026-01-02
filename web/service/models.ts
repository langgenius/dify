import type {
  ModelCredential,
  ModelItem,
  ModelLoadBalancingConfig,
  ModelTypeEnum,
  ProviderCredential,
} from '@/app/components/header/account-setting/model-provider-page/declarations'
import { del, get, post, put } from './base'

export const fetchModelProviderModelList = (provider: string) => {
  return get<{ data: ModelItem[] }>(`/workspaces/current/model-providers/${provider}/models`)
}

export const fetchProviderCredential = (provider: string, credentialId?: string) => {
  return get<ProviderCredential>(`/workspaces/current/model-providers/${provider}/credentials${credentialId ? `?credential_id=${credentialId}` : ''}`)
}

export const addProviderCredential = (provider: string, data: ProviderCredential) => {
  return post<{ result: string }>(`/workspaces/current/model-providers/${provider}/credentials`, {
    body: data,
  })
}

export const editProviderCredential = (provider: string, data: ProviderCredential) => {
  return put<{ result: string }>(`/workspaces/current/model-providers/${provider}/credentials`, {
    body: data,
  })
}

export const deleteProviderCredential = (provider: string, data: { credential_id: string }) => {
  return del<{ result: string }>(`/workspaces/current/model-providers/${provider}/credentials`, {
    body: data,
  })
}

export const activateProviderCredential = (provider: string, data: { credential_id: string, model?: string, model_type?: ModelTypeEnum }) => {
  return post<{ result: string }>(`/workspaces/current/model-providers/${provider}/credentials/switch`, {
    body: data,
  })
}

export const fetchModelCredential = (
  provider: string,
  model?: string,
  modelType?: string,
  configFrom?: string,
  credentialId?: string,
) => {
  return get<ModelCredential>(`/workspaces/current/model-providers/${provider}/models/credentials?model=${model}&model_type=${modelType}&config_from=${configFrom}${credentialId ? `&credential_id=${credentialId}` : ''}`)
}

export const addModelCredential = (provider: string, data: ModelCredential) => {
  return post<{ result: string }>(`/workspaces/current/model-providers/${provider}/models/credentials`, {
    body: data,
  })
}

export const editModelCredential = (provider: string, data: ModelCredential) => {
  return put<{ result: string }>(`/workspaces/current/model-providers/${provider}/models/credentials`, {
    body: data,
  })
}

export const deleteModelCredential = (provider: string, data: { credential_id: string, model?: string, model_type?: ModelTypeEnum }) => {
  return del<{ result: string }>(`/workspaces/current/model-providers/${provider}/models/credentials`, {
    body: data,
  })
}

export const deleteModel = (provider: string, data: { model: string, model_type: ModelTypeEnum }) => {
  return del<{ result: string }>(`/workspaces/current/model-providers/${provider}/models`, {
    body: data,
  })
}

export const activateModelCredential = (provider: string, data: { credential_id: string, model?: string, model_type?: ModelTypeEnum }) => {
  return post<{ result: string }>(`/workspaces/current/model-providers/${provider}/models/credentials/switch`, {
    body: data,
  })
}

export const updateModelLoadBalancingConfig = (provider: string, data: {
  config_from: string
  model: string
  model_type: ModelTypeEnum
  load_balancing: ModelLoadBalancingConfig
  credential_id?: string
}) => {
  return post<{ result: string }>(`/workspaces/current/model-providers/${provider}/models`, {
    body: data,
  })
}
