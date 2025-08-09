import { get } from './base'
import type {
  ModelItem,
} from '@/app/components/header/account-setting/model-provider-page/declarations'
import {
  useQuery,
  // useQueryClient,
} from '@tanstack/react-query'

const NAME_SPACE = 'models'

export const useModelProviderModelList = (provider: string) => {
  return useQuery({
    queryKey: [NAME_SPACE, 'model-list', provider],
    queryFn: () => get<{ data: ModelItem[] }>(`/workspaces/current/model-providers/${provider}/models`),
  })
}

export type ModelReference = {
  model_name: string
  model_mode: string
  model_type: string
  workflows: Array<{
    workflow_id: string | null
    app_id: string
    app_name: string
    workflow_name: string
    node_title: string
    app_type: string
  }>
}

export type ModelReferencesResponse = {
  provider: string
  models: ModelReference[]
  total_models: number
  total_workflows: number
}

export const useModelProviderReferences = (provider: string, enabled: boolean = true) => {
  return useQuery({
    queryKey: [NAME_SPACE, 'model-references', provider],
    queryFn: () => get<{ data: ModelReferencesResponse }>(`/workspaces/current/model-references/${provider}`),
    enabled: !!provider && enabled,
  })
}
