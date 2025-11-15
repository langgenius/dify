import { useEffect } from 'react'
import { useTriggerSubscriptions } from '@/service/use-triggers'
import { usePluginStore } from '../store'
import { usePluginSubscriptionStore } from './store'

export const useSubscriptionList = () => {
  const detail = usePluginStore(state => state.detail)
  const { setRefresh } = usePluginSubscriptionStore()

  const { data: subscriptions, isLoading, refetch } = useTriggerSubscriptions(detail?.provider || '')

  useEffect(() => {
    if (refetch)
      setRefresh(refetch)
  }, [refetch, setRefresh])

  return {
    detail,
    subscriptions,
    isLoading,
    refetch,
  }
}
