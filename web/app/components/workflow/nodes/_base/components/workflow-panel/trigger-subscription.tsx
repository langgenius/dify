import { useLanguage } from '@/app/components/header/account-setting/model-provider-page/hooks'
import { CreateButtonType, CreateSubscriptionButton } from '@/app/components/plugins/plugin-detail-panel/subscription-list/create'
import { SubscriptionSelectorEntry } from '@/app/components/plugins/plugin-detail-panel/subscription-list/selector-entry'
import { usePluginStore } from '@/app/components/plugins/plugin-detail-panel/subscription-list/store'
import { useSubscriptionList } from '@/app/components/plugins/plugin-detail-panel/subscription-list/use-subscription-list'
import useConfig from '@/app/components/workflow/nodes/trigger-plugin/use-config'
import type { Node } from '@/app/components/workflow/types'
import cn from '@/utils/classnames'
import type { FC } from 'react'
import { useEffect } from 'react'

type NodeAuthProps = {
  data: Node['data']
  onSubscriptionChange?: (id: string, name: string) => void
  children: React.ReactNode
}

export const TriggerSubscription: FC<NodeAuthProps> = ({ data, onSubscriptionChange, children }) => {
  // @ts-expect-error TODO: fix this
  const { currentProvider } = useConfig(data.id as string, data)
  const { setDetail } = usePluginStore()
  const language = useLanguage()
  const { subscriptions } = useSubscriptionList()
  const subscriptionCount = subscriptions?.length || 0

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

  return <div className={cn('px-4', subscriptionCount > 0 && 'flex items-center justify-between pr-3')}>
    {!subscriptionCount && <CreateSubscriptionButton buttonType={CreateButtonType.FULL_BUTTON} />}
    {children}
    {subscriptionCount > 0 && <SubscriptionSelectorEntry
      selectedId={data.subscription_id}
      onSelect={({ id, name }) => onSubscriptionChange?.(id, name)}
    />}
  </div>
}
