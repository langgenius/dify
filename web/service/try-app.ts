import {
  get,
} from './base'
import type {
  SiteInfo,
} from '@/models/share'

type TryAppInfo = {
  name: string
  mode: 'chat' | 'advanced-chat' | 'text-generation' | 'workflow'
  site: SiteInfo
}

export const fetchTryAppInfo = async (appId: string) => {
  return get(`/trial-apps/${appId}`) as Promise<TryAppInfo>
}
