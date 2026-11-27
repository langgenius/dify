import type { SimpleSubscription } from './types'
import type { PluginDetail } from '@/app/components/plugins/types'
import { Alert, AlertActions, AlertTitle } from '@langgenius/dify-ui/alert'
import { Button } from '@langgenius/dify-ui/button'
import { useTranslation } from 'react-i18next'
import { withErrorBoundary } from '@/app/components/base/error-boundary'
import { LoadingPlaceholder } from '@/app/components/base/loading-placeholder'
import { useOwnedQueryError } from '@/service/use-owned-query-error'
import { useRequestErrorMessage } from '@/service/use-request-error-message'
import { SubscriptionListView } from './list-view'
import { SubscriptionSelectorView } from './selector-view'
import { SubscriptionListMode } from './types'
import { useSubscriptionList } from './use-subscription-list'

type SubscriptionListProps = {
  mode?: SubscriptionListMode
  selectedId?: string
  onSelect?: (v: SimpleSubscription, callback?: () => void) => void
  pluginDetail?: PluginDetail
}

export type { SimpleSubscription } from './types'

export const SubscriptionList = withErrorBoundary(
  ({
    mode = SubscriptionListMode.PANEL,
    selectedId,
    onSelect,
    pluginDetail,
  }: SubscriptionListProps) => {
    const { t } = useTranslation(['common'])
    const { isLoading, subscriptionsQuery, refetch } = useSubscriptionList()
    const subscriptionsLoad = useOwnedQueryError(subscriptionsQuery)
    const loadErrorMessage = useRequestErrorMessage(subscriptionsLoad?.error)
    if (isLoading) {
      return (
        <div className="flex items-center justify-center py-4">
          <LoadingPlaceholder />
        </div>
      )
    }

    if (subscriptionsLoad && loadErrorMessage) {
      return (
        <div className="p-2">
          <Alert type="error">
            <AlertTitle>{loadErrorMessage}</AlertTitle>
            <AlertActions>
              <Button
                size="small"
                loading={subscriptionsLoad.retrying}
                onClick={subscriptionsLoad.retry}
              >
                {t(($) => $['operation.retry'], { ns: 'common' })}
              </Button>
            </AlertActions>
          </Alert>
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
  },
)
