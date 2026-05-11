'use client'
import type { PluginDetail } from '@/app/components/plugins/types'
import { cn } from '@langgenius/dify-ui/cn'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { Infotip } from '@/app/components/base/infotip'
import { CreateSubscriptionButton } from './create'
import { CreateButtonType } from './create/types'
import SubscriptionCard from './subscription-card'
import { useSubscriptionList } from './use-subscription-list'

type SubscriptionListViewProps = {
  showTopBorder?: boolean
  pluginDetail?: PluginDetail
}

export const SubscriptionListView: React.FC<SubscriptionListViewProps> = ({
  showTopBorder = false,
  pluginDetail,
}) => {
  const { t } = useTranslation()
  const { subscriptions } = useSubscriptionList()

  const subscriptionCount = subscriptions?.length || 0

  return (
    <div className={cn('border-divider-subtle px-4 py-2', showTopBorder && 'border-t')}>
      <div className="relative flex items-center justify-between">
        {subscriptionCount > 0 && (
          <div className="flex h-8 shrink-0 items-center gap-1">
            <span className="system-sm-semibold-uppercase text-text-secondary">
              {t('subscription.listNum', { ns: 'pluginTrigger', num: subscriptionCount })}
            </span>
            <Infotip
              aria-label={t('subscription.list.tip', { ns: 'pluginTrigger' })}
              className="h-3.5 w-3.5"
              iconClassName="h-full w-full"
            >
              {t('subscription.list.tip', { ns: 'pluginTrigger' })}
            </Infotip>
          </div>
        )}
        <CreateSubscriptionButton
          buttonType={subscriptionCount > 0 ? CreateButtonType.ICON_BUTTON : CreateButtonType.FULL_BUTTON}
        />
      </div>

      {subscriptionCount > 0 && (
        <div className="flex flex-col gap-1">
          {subscriptions?.map(subscription => (
            <SubscriptionCard
              key={subscription.id}
              data={subscription}
              pluginDetail={pluginDetail}
            />
          ))}
        </div>
      )}
    </div>
  )
}
