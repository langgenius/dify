'use client'

import type { ReactNode } from 'react'
import type { ContactsFeatureContextValue } from './types'
import { useQuery } from '@tanstack/react-query'
import { useAtomValue } from 'jotai'
import { useMemo } from 'react'
import {
  workspacePermissionKeysAtom,
  workspacePermissionKeysLoadingAtom,
} from '@/context/permission-state'
import { currentWorkspaceIdAtom, currentWorkspaceLoadingAtom } from '@/context/workspace-state'
import { deploymentEditionAtom } from '@/features/system-features/state'
import { consoleQuery } from '@/service/console'
import { hasPermission } from '@/utils/permission'
import { selectIMCentrallyManaged } from '../im-capability'
import { canManageContactsAtom, canViewContactsAtom } from '../permissions'
import { ContactsFeatureContext } from './composition-context'

export function ContactsManagementProvider({
  children,
  context,
}: {
  children: ReactNode
  context: ContactsFeatureContextValue
}) {
  return <ContactsFeatureContext value={context}>{children}</ContactsFeatureContext>
}

export function ContactsManagementRuntimeProvider({ children }: { children: ReactNode }) {
  const workspaceId = useAtomValue(currentWorkspaceIdAtom)
  const canViewContacts = useAtomValue(canViewContactsAtom)
  const canManageContacts = useAtomValue(canManageContactsAtom)
  const canManageMembers = hasPermission(
    useAtomValue(workspacePermissionKeysAtom),
    'workspace.member.manage',
  )
  const permissionsLoading = useAtomValue(workspacePermissionKeysLoadingAtom)
  const workspaceLoading = useAtomValue(currentWorkspaceLoadingAtom)
  const deploymentEdition = useAtomValue(deploymentEditionAtom)
  const capability = useQuery(
    consoleQuery.features.get.queryOptions({
      select: selectIMCentrallyManaged,
      retry: false,
    }),
  )
  const { error: capabilityError, refetch: refetchCapability } = capability
  const imCentrallyManaged = capability.isSuccess ? capability.data : undefined
  const deployment =
    deploymentEdition === 'ENTERPRISE'
      ? 'ee'
      : deploymentEdition === 'CLOUD'
        ? 'saas'
        : ('ce' as const)
  const context = useMemo<ContactsFeatureContextValue>(
    () => ({
      deployment,
      imCentrallyManaged,
      imCapabilityError: capabilityError,
      retryIMCapability: () => {
        void refetchCapability()
      },
      workspaceId,
      permissionsLoading: workspaceLoading || permissionsLoading,
      permissions: {
        canViewContacts: Boolean(workspaceId) && canViewContacts,
        canManageContacts: Boolean(workspaceId) && canManageContacts,
        canManageMembers: Boolean(workspaceId) && canManageMembers,
      },
    }),
    [
      canManageContacts,
      canManageMembers,
      canViewContacts,
      capabilityError,
      refetchCapability,
      deployment,
      imCentrallyManaged,
      permissionsLoading,
      workspaceId,
      workspaceLoading,
    ],
  )
  return <ContactsManagementProvider context={context}>{children}</ContactsManagementProvider>
}
