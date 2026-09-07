import { createLocalStorageState } from 'foxact/create-local-storage-state'

const [useHideMaintenanceNotice, _useHideMaintenanceNoticeValue, _useSetHideMaintenanceNotice] =
  createLocalStorageState<string>('hide-maintenance-notice', '0', { raw: true })

export { useHideMaintenanceNotice }
