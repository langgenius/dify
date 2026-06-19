import { createLocalStorageState } from 'foxact/create-local-storage-state'
import { NEED_REFRESH_APP_LIST_KEY } from '@/config'

const [
  useNeedRefreshAppList,
  _useNeedRefreshAppListValue,
  useSetNeedRefreshAppList,
] = createLocalStorageState<string>(NEED_REFRESH_APP_LIST_KEY, '0', { raw: true })

export {
  useNeedRefreshAppList,
  useSetNeedRefreshAppList,
}
