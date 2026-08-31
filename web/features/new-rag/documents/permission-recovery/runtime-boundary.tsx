'use client'

import { useAtomValue, useSetAtom } from 'jotai'
import { useLayoutEffect } from 'react'
import {
  datasetDefaultPermissionKeysAtom,
  workspacePermissionKeysErrorAtom,
  workspacePermissionKeysLoadingAtom,
} from '@/context/permission-state'
import { DatasetACLPermission, hasPermission } from '@/utils/permission'
import { documentPermissionRuntimeAtom } from '../state/runtime'
import { useDocumentPermissionRecovery } from './use-permission-recovery'

export function DocumentPermissionRuntimeController() {
  const datasetDefaultPermissionKeys = useAtomValue(datasetDefaultPermissionKeysAtom)
  const workspacePermissionKeysLoading = useAtomValue(workspacePermissionKeysLoadingAtom)
  const workspacePermissionKeysError = useAtomValue(workspacePermissionKeysErrorAtom)
  const canDownload =
    !workspacePermissionKeysLoading &&
    !workspacePermissionKeysError &&
    hasPermission(datasetDefaultPermissionKeys, DatasetACLPermission.DocumentDownload)
  const {
    canRead,
    canWrite,
    denyWrite,
    recoverySurface,
    retryWorkspacePermission,
    workspacePermissionRefreshing,
  } = useDocumentPermissionRecovery()
  const setPermissionRuntime = useSetAtom(documentPermissionRuntimeAtom)
  useLayoutEffect(() => {
    setPermissionRuntime({
      canDownload,
      canRead,
      canWrite,
      denyWrite,
      initialized: true,
      recoverySurface,
      retryWorkspacePermission,
      workspacePermissionRefreshing,
    })
  }, [
    canDownload,
    canRead,
    canWrite,
    denyWrite,
    recoverySurface,
    retryWorkspacePermission,
    setPermissionRuntime,
    workspacePermissionRefreshing,
  ])

  return null
}
