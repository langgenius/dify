import { createLocalStorageState } from 'foxact/create-local-storage-state'

type DetailSidebarMode = 'expand' | 'collapse'

export const DETAIL_SIDEBAR_STORAGE_KEY = 'app-detail-collapse-or-expand'

const [
  useDetailSidebarMode,
  _useDetailSidebarModeValue,
  useSetDetailSidebarMode,
] = createLocalStorageState<DetailSidebarMode>(DETAIL_SIDEBAR_STORAGE_KEY, 'expand', { raw: true })

export {
  useDetailSidebarMode,
  useSetDetailSidebarMode,
}
