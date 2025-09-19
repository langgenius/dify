import {
  getPublic as get,
} from './base'
import type {
  AppData,
} from '@/models/share'

// would use trial-apps after api is ok
export const fetchTryAppInfo = async () => {
  return get('/site') as Promise<AppData>
}
