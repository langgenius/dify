'use client'

import type { ComponentProps } from 'react'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { useTranslation } from 'react-i18next'
import { useWebAppEntry } from '../webapp-entry'
import ConnectionLoadState from './connection-load-state'
import RequiredConnectionSetup from './required-connection-setup'
import RequiredConnections from './required-connections'
import { useOptionalWebAppConnections } from './use-connections'

export default function WebAppConnectionSetup({
  onStart,
  className,
  previewSize,
}: {
  onStart: () => void
  className?: string
  previewSize?: ComponentProps<typeof RequiredConnections>['size']
}) {
  const { t } = useTranslation(['share'])
  const state = useOptionalWebAppConnections()
  const entry = useWebAppEntry()
  if (!state || state.status === 'inactive') return null
  if (state.status === 'sign-in-required')
    return (
      <RequiredConnections
        connections={state.services}
        showSignIn={entry?.showSignIn ?? false}
        className={className}
        size={previewSize}
      />
    )

  return (
    <div className={cn('space-y-6', className)}>
      <RequiredConnectionSetup
        services={state.services}
        onConnect={state.onConnect}
        onConnectionChange={state.onConnectionChange}
        onReconnect={state.onReconnect}
        onReplace={state.onReplace}
        onRemove={state.onRemove}
        disabled={state.status !== 'ready'}
        isMutating={state.isMutating}
      />
      <ConnectionLoadState
        loading={state.status === 'loading' || state.preflight.status === 'checking'}
        error={state.status === 'error' || state.preflight.status === 'error'}
        onRetry={
          state.status === 'error'
            ? state.retry
            : state.preflight.canRetry
              ? state.preflight.retry
              : undefined
        }
        onLoadMore={state.hasMoreConnections ? state.loadMoreConnections : undefined}
        loadingMore={state.isFetchingMoreConnections}
      />
      <Button
        variant="primary"
        size="large"
        disabled={!state.canRun || state.isMutating}
        onClick={() => {
          if (state.canRun && !state.isMutating) onStart()
        }}
      >
        {t(($) => $['connections.setup.startUsingApp'], { ns: 'share' })}
      </Button>
    </div>
  )
}
