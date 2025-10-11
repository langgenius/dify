import { withErrorBoundary } from '@/app/components/base/error-boundary'
import { SubscriptionListView } from './list-view'
import { SubscriptionSelectorView } from './selector-view'
import { useSubscriptionList } from './use-subscription-list'

export enum SubscriptionListMode {
  PANEL = 'panel',
  SELECTOR = 'selector',
}

type SubscriptionListProps = {
  mode?: SubscriptionListMode
  selectedId?: string
  onSelect?: ({ id, name }: { id: string, name: string }) => void
}

export { SubscriptionSelectorEntry } from './selector-entry'

export const SubscriptionList = withErrorBoundary(({
  mode = SubscriptionListMode.PANEL,
  selectedId,
  onSelect,
}: SubscriptionListProps) => {
  const { subscriptions, isLoading } = useSubscriptionList()

  if (mode === SubscriptionListMode.SELECTOR) {
    return (
      <SubscriptionSelectorView
        subscriptions={subscriptions}
        isLoading={isLoading}
        selectedId={selectedId}
        onSelect={onSelect}
      />
    )
  }

  return (
    <SubscriptionListView
      subscriptions={subscriptions}
      isLoading={isLoading}
    />
  )
})
