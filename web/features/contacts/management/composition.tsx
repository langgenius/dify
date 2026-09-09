'use client'

import type { ReactNode } from 'react'
import type { ContactsMockScenarioDefinition } from './mock/scenarios'
import type { ContactsManagementRepository } from './repository'
import type { ContactsFeatureContextValue } from './types'
import { useAtomValue } from 'jotai'
import { useMemo } from 'react'
import { currentWorkspaceIdAtom, isCurrentWorkspaceManagerAtom } from '@/context/workspace-state'
import { deploymentEditionAtom } from '@/features/system-features/state'
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
  const deployment =
    deploymentEdition === 'ENTERPRISE'
      ? 'ee'
      : deploymentEdition === 'CLOUD'
        ? 'saas'
        : ('ce' as const)
  const repository = useMemo(() => createContactsApiRepository(), [])
  const context = useMemo<ContactsFeatureContextValue>(
    () => ({
      deployment,
      workspaceId,
      permissions: {
        canViewContacts: Boolean(workspaceId) && canManage,
        canManageContacts: Boolean(workspaceId) && canManage,
        canManageMembers: Boolean(workspaceId) && canManage,
      },
    }),
    [canManage, deployment, workspaceId],
  )

  return (
    <ContactsManagementProvider key={workspaceId} context={context} repository={repository}>
      {children}
    </ContactsManagementProvider>
  )
}
