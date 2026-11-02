'use client'

import type { ReactNode } from 'react'
import type { ContactsImPlatformOrganizationContext } from './context'
import type { ContactImPlatformRepository } from './repository'
import { useMemo } from 'react'
import {
  ContactImPlatformOrganizationContext,
  ContactImPlatformRepositoryContext,
} from './composition-context'
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
