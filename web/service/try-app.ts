import type { AppMode } from '@/types/app'
import {
  get,
} from './base'
import type {
  SiteInfo,
} from '@/models/share'
import type { ModelConfig } from '@/types/app'
import qs from 'qs'
import type { DataSetListResponse } from '@/models/datasets'
import type { Edge, Node } from '@/app/components/workflow/types'
import type { Viewport } from 'reactflow'

type TryAppInfo = {
  name: string
  mode: AppMode
  site: SiteInfo
  model_config: ModelConfig
  deleted_tools: any[]
}

export const fetchTryAppInfo = async (appId: string) => {
  return get(`/trial-apps/${appId}`) as Promise<TryAppInfo>
}

export const fetchTryAppDatasets = (appId: string, ids: string[]) => {
  const urlParams = qs.stringify({ ids }, { indices: false })
  return get<DataSetListResponse>(`/trial-apps/${appId}/datasets?${urlParams}`)
}

type TryAppFlowPreview = {
  graph: {
    nodes: Node[]
    edges: Edge[]
    viewport: Viewport
  }
}

export const fetchTryAppFlowPreview = (appId: string) => {
  return get<TryAppFlowPreview>(`/trial-apps/${appId}/workflows`)
}
