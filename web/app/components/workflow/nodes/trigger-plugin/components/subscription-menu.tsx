'use client'

import { useLanguage } from '@/app/components/header/account-setting/model-provider-page/hooks'
import { SubscriptionSelectorEntry } from '@/app/components/plugins/plugin-detail-panel/subscription-list/selector-entry'
import { usePluginStore } from '@/app/components/plugins/plugin-detail-panel/subscription-list/store'
import { memo, useEffect } from 'react'
import type { PluginTriggerNodeType } from '../types'
import useConfig from '../use-config'

export const SubscriptionMenu = memo(({ payload, onSubscriptionSelect }: {
  payload: PluginTriggerNodeType,
  onSubscriptionSelect: ({ id, name }: { id: string, name: string }) => void
}) => {
  // @ts-expect-error TODO: fix this
  const { currentProvider } = useConfig(payload.id as string, payload)
  const { setDetail } = usePluginStore()
  const language = useLanguage()

  useEffect(() => {
    if (currentProvider) {
      setDetail({
        name: currentProvider.label[language],
        plugin_id: currentProvider.plugin_id || '',
        provider: currentProvider.name,
        declaration: {
          tool: undefined,
          // @ts-expect-error just remain the necessary fields
          trigger: {
            subscription_schema: currentProvider.subscription_schema || [],
            subscription_constructor: currentProvider.subscription_constructor,
          },
        },
      })
    }
  }, [currentProvider, setDetail])

  return (
    <SubscriptionSelectorEntry
      selectedId={payload.subscription_id}
      onSelect={onSubscriptionSelect}
    />
  )
})
