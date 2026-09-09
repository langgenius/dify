'use client'

import type { ReactNode } from 'react'
import { useAtomValue } from 'jotai'
import { ScopeProvider } from 'jotai-scope'
import { useHydrateAtoms } from 'jotai/utils'
import {
  datasetDefaultPermissionKeysAtom,
  workspacePermissionKeysErrorAtom,
  workspacePermissionKeysLoadingAtom,
} from '@/context/permission-state'
import { DatasetACLPermission, hasPermission } from '@/utils/permission'
import { useKnowledgeSpace } from '../../space/context'
import {
  documentsDownloadPermissionAtom,
  documentsKnowledgeSpaceIdAtom,
  documentsSpaceContextAtom,
} from './inputs'
import { documentsScopedAtoms } from './scoped'

function DocumentsInputs({
  children,
  knowledgeSpaceId,
}: {
  children: ReactNode
  knowledgeSpaceId: string
}) {
  const spaceContext = useKnowledgeSpace()
  const permissionKeys = useAtomValue(datasetDefaultPermissionKeysAtom)
  const permissionsLoading = useAtomValue(workspacePermissionKeysLoadingAtom)
  const permissionsError = useAtomValue(workspacePermissionKeysErrorAtom)
  const canDownload =
    !permissionsLoading &&
    !permissionsError &&
    hasPermission(permissionKeys, DatasetACLPermission.DocumentDownload)
  useHydrateAtoms(
    [
      [documentsKnowledgeSpaceIdAtom, knowledgeSpaceId],
      [documentsSpaceContextAtom, spaceContext],
      [documentsDownloadPermissionAtom, canDownload],
    ],
    {
      dangerouslyForceHydrate: true,
    },
  )

  return children
}

export function DocumentsStateBoundary({
  children,
  knowledgeSpaceId,
}: {
  children: ReactNode
  knowledgeSpaceId: string
}) {
  return (
    <ScopeProvider key={knowledgeSpaceId} atoms={documentsScopedAtoms} name="DocumentsPage">
      <DocumentsInputs knowledgeSpaceId={knowledgeSpaceId}>{children}</DocumentsInputs>
    </ScopeProvider>
  )
}
