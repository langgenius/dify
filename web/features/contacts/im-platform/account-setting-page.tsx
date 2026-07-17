'use client'

import { useMemo } from 'react'
import { ContactsImPlatformMockProvider } from './composition'
import { ContactsImPlatformManagementSurface } from './management-surface'

export function ContactsImPlatformAccountSettingPage({
  canManage,
  organizationId,
}: {
  canManage: boolean
  organizationId: string
}) {
  const organization = useMemo(
    () => ({
      canManage,
      organizationId,
      workspaceId: organizationId,
    }),
    [canManage, organizationId],
  )

  return (
    <ContactsImPlatformMockProvider organization={organization}>
      <ContactsImPlatformManagementSurface />
    </ContactsImPlatformMockProvider>
  )
}
