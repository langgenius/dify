import { createLocalStorageState } from 'foxact/create-local-storage-state'

const [useHideMaintenanceNotice, _useHideMaintenanceNoticeValue, _useSetHideMaintenanceNotice] =
  createLocalStorageState<string>('hide-maintenance-notice', '0', { raw: true })

const [_useWorkflowCanvasMaximize, useWorkflowCanvasMaximizeValue, _useSetWorkflowCanvasMaximize] =
  createLocalStorageState<boolean>('workflow-canvas-maximize', false)

export { useHideMaintenanceNotice, useWorkflowCanvasMaximizeValue }
