import type { ReactNode } from 'react'
import type { ContactsFeatureContextValue } from '../../types'
import type { ContactsMockScenarioDefinition } from './scenarios'
import { useMemo } from 'react'
import { ContactsManagementProvider } from '../../composition'
import { createContactsMockRepository } from './repository'

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
      imCentrallyManaged: scenario.imCentrallyManaged,
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
