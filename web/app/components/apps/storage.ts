import { createLocalStorageState } from 'foxact/create-local-storage-state'

export const NEED_REFRESH_APP_LIST_KEY = 'needRefreshAppList'

const [
  useNeedRefreshAppList,
  _useNeedRefreshAppListValue,
  useSetNeedRefreshAppList,
] = createLocalStorageState<string>(NEED_REFRESH_APP_LIST_KEY, '0', { raw: true })

export {
  useNeedRefreshAppList,
  useSetNeedRefreshAppList,
}
