'use client'

import { useMemo } from 'react'
import { ContactsImPlatformRuntimeProvider } from './composition'
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
    <ContactsImPlatformRuntimeProvider organization={organization}>
      <div className="-mt-2">
        <ContactsImPlatformManagementSurface />
      </div>
    </ContactsImPlatformRuntimeProvider>
  )
}
