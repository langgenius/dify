'use client'

import { createDialogHandle, DialogTrigger } from '@langgenius/dify-ui/dialog'
import { useState } from 'react'
import SignIn from '../sign-in'
import ConfigureConnectionsButton from './configure-connections-button'
import ConfigureConnectionsDialog from './configure-connections-dialog'
import { useOptionalWebAppConnections } from './use-connections'

export default function WebAppConnectionControls({
  isResponding = false,
}: {
  isResponding?: boolean
}) {
  const state = useOptionalWebAppConnections()
  const [handle] = useState(() => createDialogHandle())
  if (!state) return null
  return (
    <div className="flex items-center gap-2">
      <SignIn />
      {state.status !== 'inactive' && state.status !== 'sign-in-required' && (
        <>
          <DialogTrigger
            handle={handle}
            render={<ConfigureConnectionsButton services={state.services} />}
          />
          <ConfigureConnectionsDialog
            handle={handle}
            services={state.services}
            onConnect={state.onConnect}
            onConnectionChange={state.onConnectionChange}
            onReconnect={state.onReconnect}
            onReplace={state.onReplace}
            onRemove={state.onRemove}
            isResponding={isResponding}
            isMutating={state.isMutating}
            disabled={state.status !== 'ready'}
            loadState={{
              loading: state.status === 'loading' || state.preflight.status === 'checking',
              error: state.status === 'error' || state.preflight.status === 'error',
              onRetry:
                state.status === 'error'
                  ? state.retry
                  : state.preflight.canRetry
                    ? state.preflight.retry
                    : undefined,
              onLoadMore: state.hasMoreConnections ? state.loadMoreConnections : undefined,
              loadingMore: state.isFetchingMoreConnections,
            }}
          />
        </>
      )}
    </div>
  )
}
