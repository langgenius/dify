'use client'

import type { ContactsImPlatformOrganizationContext } from './context'
import type { ContactImPlatformRepository } from './repository'
import { createContext, use } from 'react'

export const ContactImPlatformRepositoryContext = createContext<ContactImPlatformRepository | null>(
  null,
)
export const ContactImPlatformOrganizationContext =
  createContext<ContactsImPlatformOrganizationContext | null>(null)

export const useContactsImPlatformRepository = () => {
  const repository = use(ContactImPlatformRepositoryContext)

  if (!repository) throw new Error('ContactsImPlatformProvider is required')

  return repository
}

export const useContactsImPlatformOrganization = () => {
  const organization = use(ContactImPlatformOrganizationContext)

  if (!organization) throw new Error('ContactsImPlatformProvider is required')

  return organization
}
