'use client'

import type { ContactsManagementRepository } from './repository'
import type { ContactsFeatureContextValue } from './types'
import { createContext, use } from 'react'

export const ContactsManagementRepositoryContext =
  createContext<ContactsManagementRepository | null>(null)
export const ContactsFeatureContext = createContext<ContactsFeatureContextValue | null>(null)

export function useContactsManagementRepository() {
  const repository = use(ContactsManagementRepositoryContext)
  if (!repository) throw new Error('ContactsManagementProvider is required')
  return repository
}

export function useContactsFeatureContext() {
  const context = use(ContactsFeatureContext)
  if (!context) throw new Error('ContactsManagementProvider is required')
  return context
}

export function useOptionalContactsManagement() {
  return {
    context: use(ContactsFeatureContext),
    repository: use(ContactsManagementRepositoryContext),
  }
}
