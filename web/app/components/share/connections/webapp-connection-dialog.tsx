'use client'

import type { ComponentProps } from 'react'
import ConfigureConnectionsDialog from './configure-connections-dialog'
import { useOptionalWebAppConnections } from './use-connections'

export default function WebAppConnectionDialog({
  handle,
  finalFocus,
  isResponding = false,
}: Pick<
  ComponentProps<typeof ConfigureConnectionsDialog>,
  'handle' | 'isResponding' | 'finalFocus'
>) {
  const state = useOptionalWebAppConnections()
  if (!state || state.status === 'inactive' || state.status === 'sign-in-required') return null

  return (
    <ConfigureConnectionsDialog
      handle={handle}
      finalFocus={finalFocus}
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
  )
}
