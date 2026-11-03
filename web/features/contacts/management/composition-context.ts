'use client'

import type { ContactsFeatureContextValue } from './types'
import { createContext, use } from 'react'

export const ContactsFeatureContext = createContext<ContactsFeatureContextValue | null>(null)

export function useContactsFeatureContext() {
  const context = use(ContactsFeatureContext)
  if (!context) throw new Error('ContactsManagementProvider is required')
  return context
}
