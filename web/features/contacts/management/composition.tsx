'use client'

import type { ReactNode } from 'react'
import type { ContactsManagementRepository } from './repository'
import type { ContactsFeatureContextValue } from './types'
import { useQuery } from '@tanstack/react-query'
import { useAtomValue } from 'jotai'
import { useMemo } from 'react'
import { currentWorkspaceIdAtom, isCurrentWorkspaceManagerAtom } from '@/context/workspace-state'
import { deploymentEditionAtom } from '@/features/system-features/state'
import { consoleQuery } from '@/service/console'
import { selectIMCentrallyManaged } from '../im-capability'
import { ContactsFeatureContext, ContactsManagementRepositoryContext } from './composition-context'
import { createContactsApiRepository } from './repository'

export function ContactsManagementProvider({
  children,
  context,
  repository,
}: {
  children: ReactNode
  context: ContactsFeatureContextValue
  repository: ContactsManagementRepository
}) {
  return (
    <ContactsFeatureContext value={context}>
      <ContactsManagementRepositoryContext value={repository}>
        {children}
      </ContactsManagementRepositoryContext>
    </ContactsFeatureContext>
  )
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
      permissions: {
        canViewContacts: Boolean(workspaceId) && canManage,
        canManageContacts: Boolean(workspaceId) && canManage,
        canManageMembers: Boolean(workspaceId) && canManage,
      },
    }),
    [canManage, capabilityError, refetchCapability, deployment, imCentrallyManaged, workspaceId],
  )
  const repository = useMemo(() => createContactsApiRepository(undefined, context), [context])

  return (
    <ContactsManagementProvider context={context} repository={repository}>
      {children}
    </ContactsManagementProvider>
  )
}
