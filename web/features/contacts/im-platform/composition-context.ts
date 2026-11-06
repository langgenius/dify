'use client'
import type { ContactsImPlatformOrganizationContext } from './context'
import { createContext, use } from 'react'
export const ContactImPlatformOrganizationContext =
  createContext<ContactsImPlatformOrganizationContext | null>(null)
export const useContactsImPlatformOrganization = () => {
  const organization = use(ContactImPlatformOrganizationContext)
  if (!organization) throw new Error('ContactsImPlatformProvider is required')
  return organization
}
