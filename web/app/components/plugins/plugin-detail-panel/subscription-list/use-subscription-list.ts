import { useLoadFailureMeta } from '@/hooks/use-load-failure-meta'
import { useTriggerSubscriptions } from '@/service/use-triggers'
import { usePluginStore } from '../store'

export const useSubscriptionList = () => {
  const detail = usePluginStore((state) => state.detail)

  const {
    data: subscriptions,
    isLoading,
    refetch,
  } = useTriggerSubscriptions(detail?.provider || '', true, { meta: useLoadFailureMeta() })

  return {
    detail,
    subscriptions,
    isLoading,
    refetch,
  }
}
