'use client'

import type { ReactNode } from 'react'
import type { ContactsMockScenarioDefinition } from './mock/scenarios'
import type { ContactsManagementRepository } from './repository'
import type { ContactsFeatureContextValue } from './types'
import { useQuery } from '@tanstack/react-query'
import { useAtomValue } from 'jotai'
import { useMemo } from 'react'
import { currentWorkspaceIdAtom, isCurrentWorkspaceManagerAtom } from '@/context/workspace-state'
import { deploymentEditionAtom } from '@/features/system-features/state'
import { consoleQuery } from '@/service/console'
import { selectIMBindingCentrallyManaged } from '../im-binding-capability'
import { ContactsFeatureContext, ContactsManagementRepositoryContext } from './composition-context'
import { createContactsMockRepository } from './mock/repository'
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

export function ContactsManagementMockProvider({
  children,
  scenario,
  wait,
}: {
  children: ReactNode
  scenario: ContactsMockScenarioDefinition
  wait?: () => Promise<void>
}) {
  const context = useMemo<ContactsFeatureContextValue>(
    () => ({
      deployment: scenario.deployment,
      imBindingCentrallyManaged: scenario.imBindingCentrallyManaged,
      permissions: scenario.permissions,
      workspaceId: scenario.workspaceId,
    }),
    [scenario],
  )
  const repository = useMemo(
    () => createContactsMockRepository({ scenario, wait }),
    [scenario, wait],
  )

  return (
    <ContactsManagementProvider context={context} repository={repository}>
      {children}
    </ContactsManagementProvider>
  )
}

export function ContactsManagementRuntimeProvider({ children }: { children: ReactNode }) {
  const workspaceId = useAtomValue(currentWorkspaceIdAtom)
  const canManage = useAtomValue(isCurrentWorkspaceManagerAtom)
  const deploymentEdition = useAtomValue(deploymentEditionAtom)
  const capability = useQuery(
    consoleQuery.features.get.queryOptions({
      select: selectIMBindingCentrallyManaged,
      retry: false,
    }),
  )
  const { error: capabilityError, refetch: refetchCapability } = capability
  const imBindingCentrallyManaged = capability.isSuccess ? capability.data : undefined
  const deployment =
    deploymentEdition === 'ENTERPRISE'
      ? 'ee'
      : deploymentEdition === 'CLOUD'
        ? 'saas'
        : ('ce' as const)
  const context = useMemo<ContactsFeatureContextValue>(
    () => ({
      deployment,
      imBindingCentrallyManaged,
      imBindingCapabilityError: capabilityError,
      retryIMBindingCapability: () => {
        void refetchCapability()
      },
      workspaceId,
      permissions: {
        canViewContacts: Boolean(workspaceId) && canManage,
        canManageContacts: Boolean(workspaceId) && canManage,
        canManageMembers: Boolean(workspaceId) && canManage,
      },
    }),
    [
      canManage,
      capabilityError,
      refetchCapability,
      deployment,
      imBindingCentrallyManaged,
      workspaceId,
    ],
  )
  const repository = useMemo(() => createContactsApiRepository(undefined, context), [context])

  return (
    <ContactsManagementProvider key={workspaceId} context={context} repository={repository}>
      {children}
    </ContactsManagementProvider>
  )
}
