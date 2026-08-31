import type { PermissionRecoveryWriteStatus } from './runtime-state'

export type DocumentPermissionRecoveryRuntime = {
  canRetryRead: boolean
  denialIdentity: string
  retryRead: () => void
  writeStatus: PermissionRecoveryWriteStatus
}
