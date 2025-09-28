'use client'

import { SubscriptionSelectorEntry } from '@/app/components/plugins/plugin-detail-panel/subscription-list/selector-entry'
import { usePluginStore } from '@/app/components/plugins/plugin-detail-panel/subscription-list/store'
import { memo, useEffect } from 'react'
import type { PluginTriggerNodeType } from '../types'
import useConfig from '../use-config'

export const SubscriptionMenu = memo(({ payload, selectedSubscriptionId, onSubscriptionSelect }: {
  payload: PluginTriggerNodeType,
  selectedSubscriptionId?: string,
  onSubscriptionSelect: ({ id, name }: { id: string, name: string }) => void
}) => {
  // @ts-expect-error TODO: fix this
  const { currentProvider } = useConfig(payload.id as string, payload)
  const { setDetail } = usePluginStore()

  useEffect(() => {
    if (currentProvider) {
      setDetail({
        plugin_id: currentProvider.plugin_id || '',
        provider: currentProvider.name,
        declaration: {
          tool: undefined,
          endpoint: undefined,
          trigger: {
            subscription_schema: currentProvider.subscription_schema,
            credentials_schema: currentProvider.credentials_schema,
            oauth_schema: {
              client_schema: currentProvider.oauth_client_schema,
            },
          },
        },
      })
    }
  }, [currentProvider, setDetail])

  return (
    <SubscriptionSelectorEntry
      selectedId={selectedSubscriptionId}
      onSelect={onSubscriptionSelect}
    />
  )
})
