'use client'

import type { ReactNode } from 'react'
import { useAtomValueRawSync } from 'jotai'
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
  const permissionKeys = useAtomValueRawSync(datasetDefaultPermissionKeysAtom)
  const permissionsLoading = useAtomValueRawSync(workspacePermissionKeysLoadingAtom)
  const permissionsError = useAtomValueRawSync(workspacePermissionKeysErrorAtom)
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
