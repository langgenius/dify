'use client'
import React from 'react'
import { useTranslation } from 'react-i18next'
import Tooltip from '@/app/components/base/tooltip'
import cn from '@/utils/classnames'
import { CreateButtonType, CreateSubscriptionButton } from './create'
import SubscriptionCard from './subscription-card'
import type { TriggerSubscription } from '@/app/components/workflow/block-selector/types'

type SubscriptionListViewProps = {
  subscriptions?: TriggerSubscription[]
  isLoading: boolean
  showTopBorder?: boolean
}

export const SubscriptionListView: React.FC<SubscriptionListViewProps> = ({
  subscriptions,
  isLoading,
  showTopBorder = false,
}) => {
  const { t } = useTranslation()

  if (isLoading) {
    return (
      <div className={cn('border-divider-subtle px-4 py-2', showTopBorder && 'border-t')}>
        <div className='flex items-center justify-center py-8'>
          <div className='text-text-tertiary'>{t('common.dataLoading')}</div>
        </div>
      </div>
    )
  }

  return (
    <div className={cn('border-divider-subtle px-4 py-2', showTopBorder && 'border-t')}>
      <div className='relative mb-3 flex items-center justify-between'>
        {subscriptions?.length && (
          <div className='flex shrink-0 items-center gap-1'>
            <span className='system-sm-semibold-uppercase text-text-secondary'>
              {t('pluginTrigger.subscription.listNum', { num: subscriptions?.length || 0 })}
            </span>
            <Tooltip popupContent={t('pluginTrigger.subscription.list.tip')} />
          </div>
        )}
        <CreateSubscriptionButton
          buttonType={subscriptions?.length ? CreateButtonType.ICON_BUTTON : CreateButtonType.FULL_BUTTON}
        />
      </div>

      {subscriptions?.length && (
        <div className='flex flex-col gap-1'>
          {subscriptions?.map(subscription => (
            <SubscriptionCard
              key={subscription.id}
              data={subscription}
            />
          ))}
        </div>
      )}
    </div>
  )
}
