import type { TriggerEvent } from '@/app/components/plugins/types'
import type { TriggerProviderApiEntity } from '@/app/components/workflow/block-selector/types'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useLanguage } from '@/app/components/header/account-setting/model-provider-page/hooks'
import { useTriggerProviderInfo } from '@/service/use-triggers'
import { cn } from '@/utils/classnames'
import { usePluginStore } from '../store'
import { EventDetailDrawer } from './event-detail-drawer'

type TriggerEventCardProps = {
  eventInfo: TriggerEvent
  providerInfo: TriggerProviderApiEntity
}

const TriggerEventCard = ({ eventInfo, providerInfo }: TriggerEventCardProps) => {
  const { identity, description } = eventInfo
  const language = useLanguage()
  const [showDetail, setShowDetail] = useState(false)
  const title = identity.label?.[language] ?? identity.label?.en_US ?? ''
  const descriptionText = description?.[language] ?? description?.en_US ?? ''
  return (
    <>
      <div
        className={cn('bg-components-panel-item-bg cursor-pointer rounded-xl border-[0.5px] border-components-panel-border-subtle px-4 py-3 shadow-xs hover:bg-components-panel-on-panel-item-bg-hover')}
        onClick={() => setShowDetail(true)}
      >
        <div className="system-md-semibold pb-0.5 text-text-secondary">{title}</div>
        <div className="system-xs-regular line-clamp-2 text-text-tertiary" title={descriptionText}>{descriptionText}</div>
      </div>
      {showDetail && (
        <EventDetailDrawer
          eventInfo={eventInfo}
          providerInfo={providerInfo}
          onClose={() => setShowDetail(false)}
        />
      )}
    </>
  )
}

export const TriggerEventsList = () => {
  const { t } = useTranslation()
  const detail = usePluginStore(state => state.detail)

  const { data: providerInfo } = useTriggerProviderInfo(detail?.provider || '')
  const triggerEvents = providerInfo?.events || []

  if (!providerInfo || !triggerEvents.length)
    return null

  return (
    <div className="px-4 pb-4 pt-2">
      <div className="mb-1 py-1">
        <div className="system-sm-semibold-uppercase mb-1 flex h-6 items-center justify-between text-text-secondary">
          {t('events.actionNum', { ns: 'pluginTrigger', num: triggerEvents.length, event: t(`events.${triggerEvents.length > 1 ? 'events' : 'event'}`, { ns: 'pluginTrigger' }) })}
        </div>
      </div>
      <div className="flex flex-col gap-2">
        {
          triggerEvents.map((triggerEvent: TriggerEvent) => (
            <TriggerEventCard
              key={`${detail?.plugin_id}${triggerEvent.identity?.name || ''}`}
              eventInfo={triggerEvent}
              providerInfo={providerInfo}
            />
          ))
        }
      </div>
    </div>
  )
}
