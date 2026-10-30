'use client'
import type { ReactNode } from 'react'
import type { ContactsImPlatformOrganizationContext } from './context'
import { ContactImPlatformOrganizationContext } from './composition-context'
export function ContactsImPlatformRuntimeProvider({
  children,
  organization,
}: {
  children: ReactNode
  organization: ContactsImPlatformOrganizationContext
}) {
  return (
    <ContactImPlatformOrganizationContext value={organization}>
      {children}
    </ContactImPlatformOrganizationContext>
  )
}
