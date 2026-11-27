import { useQuery } from '@tanstack/react-query'
import { triggerSubscriptionsQueryOptions } from '@/service/trigger-queries'
import { usePluginStore } from '../store'

export const useSubscriptionList = () => {
  const detail = usePluginStore((state) => state.detail)

  const {
    data: subscriptions,
    isLoading,
    refetch,
  } = useQuery(triggerSubscriptionsQueryOptions(detail?.provider || ''))

  return {
    detail,
    subscriptions,
    isLoading,
    refetch,
  }
}
