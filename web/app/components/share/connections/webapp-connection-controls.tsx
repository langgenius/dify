'use client'

import { createDialogHandle, DialogTrigger } from '@langgenius/dify-ui/dialog'
import { useState } from 'react'
import SignIn from '../sign-in'
import ConfigureConnectionsButton from './configure-connections-button'
import { useOptionalWebAppConnections } from './use-connections'
import WebAppConnectionDialog from './webapp-connection-dialog'

export default function WebAppConnectionControls({
  isResponding = false,
  showSignIn = true,
}: {
  isResponding?: boolean
  showSignIn?: boolean
}) {
  const state = useOptionalWebAppConnections()
  const [handle] = useState(() => createDialogHandle())
  if (!state) return null
  return (
    <div className="flex items-center gap-2">
      {showSignIn && <SignIn />}
      {state.status !== 'inactive' && state.status !== 'sign-in-required' && (
        <>
          <DialogTrigger
            handle={handle}
            render={<ConfigureConnectionsButton services={state.services} />}
          />
          <WebAppConnectionDialog handle={handle} isResponding={isResponding} />
        </>
      )}
    </div>
  )
}
