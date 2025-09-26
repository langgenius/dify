import Tooltip from '@/app/components/base/tooltip'
import { useTriggerSubscriptions } from '@/service/use-triggers'
import cn from '@/utils/classnames'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { usePluginStore, usePluginSubscriptionStore } from '../store'
import { CreateButtonType, CreateSubscriptionButton } from './create'
import SubscriptionCard from './subscription-card'

export const SubscriptionList = () => {
  const { t } = useTranslation()
  const detail = usePluginStore(state => state.detail)

  const showTopBorder = detail?.declaration.tool || detail?.declaration.endpoint
  const provider = `${detail?.plugin_id}/${detail?.declaration.name}`

  const { data: subscriptions, isLoading, refetch } = useTriggerSubscriptions(provider, !!detail?.plugin_id && !!detail?.declaration.name)

  const { setRefresh } = usePluginSubscriptionStore()

  useEffect(() => {
    if (refetch)
      setRefresh(refetch)
  }, [refetch])

  if (isLoading) {
    return (
      <div className={cn('border-divider-subtle px-4 py-2', showTopBorder && 'border-t')}>
        <div className='flex items-center justify-center py-8'>
          <div className='text-text-tertiary'>{t('common.dataLoading')}</div>
        </div>
      </div>
    )
  }

  const hasSubscriptions = subscriptions && subscriptions.length > 0

  return (
    <div className={cn('border-divider-subtle px-4 py-2', showTopBorder && 'border-t')}>
      <div className='relative mb-3 flex items-center justify-between'>
        {
          hasSubscriptions
          && <div className='flex shrink-0 items-center gap-1'>
            <span className='system-sm-semibold-uppercase text-text-secondary'>
              {t('pluginTrigger.subscription.listNum', { num: subscriptions?.length || 0 })}
            </span>
            <Tooltip popupContent={t('pluginTrigger.subscription.list.tip')} />
          </div>
        }
        <CreateSubscriptionButton buttonType={hasSubscriptions ? CreateButtonType.ICON_BUTTON : CreateButtonType.FULL_BUTTON} />
      </div>

      {hasSubscriptions
        && <div className='flex flex-col gap-1'>
          {subscriptions?.map(subscription => (
            <SubscriptionCard
              key={subscription.id}
              data={subscription}
            />
          ))}
        </div>}
    </div>
  )
}
