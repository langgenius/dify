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

type TryAppInfo = {
  name: string
  mode: AppMode
  site: SiteInfo
  model_config: ModelConfig
}

export const fetchTryAppInfo = async (appId: string) => {
  return get(`/trial-apps/${appId}`) as Promise<TryAppInfo>
}

export const fetchTryAppDatasets = (appId: string, ids: string[]) => {
  const urlParams = qs.stringify({ ids }, { indices: false })
  return get<DataSetListResponse>(`/trial-apps/${appId}/datasets?${urlParams}`)
}
