import { createLocalStorageState } from 'foxact/create-local-storage-state'

const [
  useDetailSidebarMode,
  _useDetailSidebarModeValue,
  _useSetDetailSidebarMode,
] = createLocalStorageState<string>('app-detail-collapse-or-expand', 'expand', { raw: true })

export {
  useDetailSidebarMode,
}
