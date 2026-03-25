import type { FC } from 'react'
import type { SimpleSubscription } from '@/app/components/plugins/plugin-detail-panel/subscription-list'
import { CreateButtonType, CreateSubscriptionButton } from '@/app/components/plugins/plugin-detail-panel/subscription-list/create'
import { SubscriptionSelectorEntry } from '@/app/components/plugins/plugin-detail-panel/subscription-list/selector-entry'
import { useSubscriptionList } from '@/app/components/plugins/plugin-detail-panel/subscription-list/use-subscription-list'
import { cn } from '@/utils/classnames'

type TriggerSubscriptionProps = {
  subscriptionIdSelected?: string
  onSubscriptionChange: (v: SimpleSubscription, callback?: () => void) => void
  children: React.ReactNode
}

export const TriggerSubscription: FC<TriggerSubscriptionProps> = ({ subscriptionIdSelected, onSubscriptionChange, children }) => {
  const { subscriptions } = useSubscriptionList()
  const subscriptionCount = subscriptions?.length || 0

  return (
    <div className={cn('px-4', subscriptionCount > 0 && 'flex items-center justify-between pr-3')}>
      {!subscriptionCount && <CreateSubscriptionButton buttonType={CreateButtonType.FULL_BUTTON} />}
      {children}
      {subscriptionCount > 0 && (
        <SubscriptionSelectorEntry
          selectedId={subscriptionIdSelected}
          onSelect={onSubscriptionChange}
        />
      )}
    </div>
  )
}
