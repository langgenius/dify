import { useQuery } from '@tanstack/react-query'
import { triggerSubscriptionsQueryOptions } from '@/service/trigger-queries'
import { usePluginStore } from '../store'

export const useSubscriptionList = () => {
  const detail = usePluginStore((state) => state.detail)

  const subscriptionsQuery = useQuery(triggerSubscriptionsQueryOptions(detail?.provider || ''))
  const { data: subscriptions, isLoading, refetch } = subscriptionsQuery

  return {
    detail,
    subscriptions,
    isLoading,
    // A failed first load is not an empty list; the caller that renders it claims it.
    subscriptionsQuery,
    refetch,
  }
}
