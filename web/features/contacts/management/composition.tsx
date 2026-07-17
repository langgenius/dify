'use client'

import type { ReactNode } from 'react'
import type { ContactsMockScenarioDefinition } from './mock/scenarios'
import type { ContactsManagementRepository } from './repository'
import type { ContactsFeatureContextValue } from './types'
import { useAtomValue } from 'jotai'
import { useMemo } from 'react'
import { Plan } from '@/app/components/billing/type'
import { IS_CLOUD_EDITION } from '@/config'
import { useProviderContext } from '@/context/provider-context'
import { currentWorkspaceIdAtom, isCurrentWorkspaceManagerAtom } from '@/context/workspace-state'
import { ContactsFeatureContext, ContactsManagementRepositoryContext } from './composition-context'
import { createContactsMockRepository } from './mock/repository'
import { createDefaultContactsScenario } from './mock/scenarios'

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
  const { plan } = useProviderContext()
  const deployment =
    plan.type === Plan.enterprise ? 'ee' : IS_CLOUD_EDITION ? 'saas' : ('ce' as const)
  const scenario = useMemo(() => {
    const defaultScenario = createDefaultContactsScenario(deployment, canManage)
    return { ...defaultScenario, workspaceId: workspaceId || defaultScenario.workspaceId }
  }, [canManage, deployment, workspaceId])

  return (
    <ContactsManagementMockProvider scenario={scenario}>{children}</ContactsManagementMockProvider>
  )
}
