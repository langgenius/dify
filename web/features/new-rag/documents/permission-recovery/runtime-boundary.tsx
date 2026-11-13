'use client'

import { useDocumentPermissionRecovery } from './use-permission-recovery'

export function DocumentPermissionRuntimeController() {
  useDocumentPermissionRecovery()
  return null
}
