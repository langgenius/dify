import type { AppMode } from '@/types/app'
import {
  get,
} from './base'
import type {
  SiteInfo,
} from '@/models/share'
import type { ModelConfig } from '@/types/app'

type TryAppInfo = {
  name: string
  mode: AppMode
  site: SiteInfo
  model_config: ModelConfig
}

export const fetchTryAppInfo = async (appId: string) => {
  return get(`/trial-apps/${appId}`) as Promise<TryAppInfo>
}
