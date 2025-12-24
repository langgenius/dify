import type { PluginDetail } from '@/app/components/plugins/types'
import { withErrorBoundary } from '@/app/components/base/error-boundary'
import Loading from '@/app/components/base/loading'
import { SubscriptionListView } from './list-view'
import { SubscriptionSelectorView } from './selector-view'
import { useSubscriptionList } from './use-subscription-list'

export enum SubscriptionListMode {
  PANEL = 'panel',
  SELECTOR = 'selector',
}

export type SimpleSubscription = {
  id: string
  name: string
}

type SubscriptionListProps = {
  mode?: SubscriptionListMode
  selectedId?: string
  onSelect?: (v: SimpleSubscription, callback?: () => void) => void
  pluginDetail?: PluginDetail
}

export { SubscriptionSelectorEntry } from './selector-entry'

export const SubscriptionList = withErrorBoundary(({
  mode = SubscriptionListMode.PANEL,
  selectedId,
  onSelect,
  pluginDetail,
}: SubscriptionListProps) => {
  const { isLoading, refetch } = useSubscriptionList()
  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-4">
        <Loading />
      </div>
    )
  }

  if (mode === SubscriptionListMode.SELECTOR) {
    return (
      <SubscriptionSelectorView
        selectedId={selectedId}
        onSelect={(v) => {
          onSelect?.(v, refetch)
        }}
      />
    )
  }

  return <SubscriptionListView pluginDetail={pluginDetail} />
})
