'use client'

import { useAtomValue } from 'jotai'
import { useEffect } from 'react'
import Loading from '@/app/components/base/loading'
import {
  currentWorkspaceIdAtom,
  currentWorkspaceLoadingAtom,
  workspacePermissionKeysAtom,
  workspacePermissionKeysLoadingAtom,
} from '@/context/app-context-state'
import { ExternalApiPanelProvider } from '@/context/external-api-panel-context'
import { ExternalKnowledgeApiProvider } from '@/context/external-knowledge-api-context'
import { usePathname, useRouter } from '@/next/navigation'
import { hasPermission } from '@/utils/permission'

const isDatasetCreatePath = (pathname: string) => {
  return pathname === '/datasets/create'
    || pathname.startsWith('/datasets/create/')
    || pathname === '/datasets/create-from-pipeline'
    || pathname.startsWith('/datasets/create-from-pipeline/')
}

const isDatasetExternalConnectPath = (pathname: string) => {
  return pathname === '/datasets/connect'
    || pathname.startsWith('/datasets/connect/')
}

export default function DatasetsLayout({ children }: { children: React.ReactNode }) {
  const currentWorkspaceId = useAtomValue(currentWorkspaceIdAtom)
  const isLoadingCurrentWorkspace = useAtomValue(currentWorkspaceLoadingAtom)
  const isLoadingWorkspacePermissionKeys = useAtomValue(workspacePermissionKeysLoadingAtom)
  const workspacePermissionKeys = useAtomValue(workspacePermissionKeysAtom)
  const router = useRouter()
  const pathname = usePathname()
  const isLoadingAccess = isLoadingCurrentWorkspace || !!isLoadingWorkspacePermissionKeys
  const canCreateDataset = hasPermission(workspacePermissionKeys, 'dataset.create_and_management')
  const canConnectExternalDataset = hasPermission(workspacePermissionKeys, 'dataset.external.connect')
  const shouldRedirectToDatasets = !isLoadingAccess
    && !!currentWorkspaceId
    && ((isDatasetCreatePath(pathname) && !canCreateDataset)
      || (isDatasetExternalConnectPath(pathname) && !canConnectExternalDataset))

  useEffect(() => {
    if (shouldRedirectToDatasets)
      router.replace('/datasets')
  }, [shouldRedirectToDatasets, router])

  if (isLoadingAccess || !currentWorkspaceId)
    return <Loading type="app" />

  if (shouldRedirectToDatasets) {
    return null
  }

  return (
    <ExternalKnowledgeApiProvider enabled={canConnectExternalDataset}>
      <ExternalApiPanelProvider>
        {children}
      </ExternalApiPanelProvider>
    </ExternalKnowledgeApiProvider>
  )
}
