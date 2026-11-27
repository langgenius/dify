'use client'

import type { ReactNode } from 'react'
import type { ContactsFeatureContextValue } from './types'
import { useQuery } from '@tanstack/react-query'
import { useAtomValue } from 'jotai'
import { useMemo } from 'react'
import { currentWorkspaceIdAtom, isCurrentWorkspaceManagerAtom } from '@/context/workspace-state'
import { deploymentEditionAtom } from '@/features/system-features/state'
import { consoleQuery } from '@/service/console'
import { useOwnedQueryError } from '@/service/use-owned-query-error'
import { selectIMCentrallyManaged } from '../im-capability'
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
  const canManage = useAtomValue(isCurrentWorkspaceManagerAtom)
  const deploymentEdition = useAtomValue(deploymentEditionAtom)
  const capability = useQuery(
    consoleQuery.features.get.queryOptions({
      select: selectIMCentrallyManaged,
      retry: false,
    }),
  )
  const canViewContacts = Boolean(workspaceId) && canManage
  // The directory replaces itself with a failed first capability read; a failed refresh keeps the
  // resolved capability and is the query cache's to report.
  const capabilityLoad = useOwnedQueryError(capability, canViewContacts)
  const imCentrallyManaged = capability.data
  const deployment =
    deploymentEdition === 'ENTERPRISE'
      ? 'ee'
      : deploymentEdition === 'CLOUD'
        ? 'saas'
        : ('ce' as const)
  const capabilityError = capabilityLoad?.error
  const retryIMCapability = capabilityLoad?.retry
  const context = useMemo<ContactsFeatureContextValue>(
    () => ({
      deployment,
      imCentrallyManaged,
      imCapabilityError: capabilityError,
      retryIMCapability,
      workspaceId,
      permissions: {
        canViewContacts,
        canManageContacts: canViewContacts,
        canManageMembers: canViewContacts,
      },
    }),
    [
      canViewContacts,
      capabilityError,
      retryIMCapability,
      deployment,
      imCentrallyManaged,
      workspaceId,
    ],
  )
  return <ContactsManagementProvider context={context}>{children}</ContactsManagementProvider>
}
