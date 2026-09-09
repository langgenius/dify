'use client'

import type { ReactNode } from 'react'
import type { ContactsImPlatformOrganizationContext } from './context'
import type { ContactImMockScenario } from './mock/scenarios'
import type { ContactImPlatformRepository } from './repository'
import { useMemo } from 'react'
import {
  ContactImPlatformOrganizationContext,
  ContactImPlatformRepositoryContext,
} from './composition-context'
import { createContactImMockRepository } from './mock/repository'
import { ContactImMockScenario as MockScenario } from './mock/scenarios'
import { createContactImApiRepository } from './repository'

export type ContactsImPlatformProviderProps = {
  children: ReactNode
  organization: ContactsImPlatformOrganizationContext
  repository: ContactImPlatformRepository
}

export function ContactsImPlatformProvider({
  children,
  organization,
  repository,
}: ContactsImPlatformProviderProps) {
  return (
    <ContactImPlatformOrganizationContext value={organization}>
      <ContactImPlatformRepositoryContext value={repository}>
        {children}
      </ContactImPlatformRepositoryContext>
    </ContactImPlatformOrganizationContext>
  )
}

export function ContactsImPlatformMockProvider({
  children,
  organization,
  scenario = MockScenario.ChannelsConfigured,
}: {
  children: ReactNode
  organization: ContactsImPlatformOrganizationContext
  scenario?: ContactImMockScenario
}) {
  const repository = useMemo(
    () => createContactImMockRepository({ organization, scenario }),
    [organization, scenario],
  )

  return (
    <ContactsImPlatformProvider organization={organization} repository={repository}>
      {children}
    </ContactsImPlatformProvider>
  )
}

export function ContactsImPlatformRuntimeProvider({
  children,
  organization,
}: {
  children: ReactNode
  organization: ContactsImPlatformOrganizationContext
}) {
  const repository = useMemo(() => createContactImApiRepository(organization), [organization])
  return (
    <ContactsImPlatformProvider
      key={repository.queryKey}
      organization={organization}
      repository={repository}
    >
      {children}
    </ContactsImPlatformProvider>
  )
}
