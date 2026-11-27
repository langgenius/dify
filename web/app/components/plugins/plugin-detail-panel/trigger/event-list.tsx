import type { TriggerEvent } from '@/app/components/plugins/types'
import type { TriggerProviderApiEntity } from '@/app/components/workflow/block-selector/types'
import { Alert, AlertActions, AlertTitle } from '@langgenius/dify-ui/alert'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { useQuery } from '@tanstack/react-query'
import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useLanguage } from '@/app/components/header/account-setting/model-provider-page/hooks'
import { triggerProviderInfoQueryOptions } from '@/service/trigger-queries'
import { useOwnedQueryError } from '@/service/use-owned-query-error'
import { useRequestErrorMessage } from '@/service/use-request-error-message'
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
  const titleId = useId()
  const descriptionId = useId()
  const title = identity.label?.[language] ?? identity.label?.en_US ?? ''
  const descriptionText = description?.[language] ?? description?.en_US ?? ''
  return (
    <>
      <button
        type="button"
        aria-labelledby={titleId}
        aria-describedby={descriptionText ? descriptionId : undefined}
        className={cn(
          'bg-components-panel-item-bg w-full cursor-pointer rounded-xl border-[0.5px] border-components-panel-border-subtle px-4 py-3 text-start shadow-xs outline-hidden hover:bg-components-panel-on-panel-item-bg-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid',
        )}
        onClick={() => setShowDetail(true)}
      >
        <div id={titleId} className="pb-0.5 system-md-semibold text-text-secondary">
          {title}
        </div>
        <div id={descriptionId} className="line-clamp-2 system-xs-regular text-text-tertiary">
          {descriptionText}
        </div>
      </button>
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
  const { t } = useTranslation(['pluginTrigger', 'common'])
  const detail = usePluginStore((state) => state.detail)

  const providerInfoQuery = useQuery(triggerProviderInfoQueryOptions(detail?.provider || ''))
  const { data: providerInfo } = providerInfoQuery
  const providerInfoLoad = useOwnedQueryError(providerInfoQuery)
  const loadErrorMessage = useRequestErrorMessage(providerInfoLoad?.error)
  const triggerEvents = providerInfo?.events || []

  if (providerInfoLoad && loadErrorMessage) {
    return (
      <div className="px-4 pt-2 pb-4">
        <Alert type="error">
          <AlertTitle>{loadErrorMessage}</AlertTitle>
          <AlertActions>
            <Button
              size="small"
              loading={providerInfoLoad.retrying}
              onClick={providerInfoLoad.retry}
            >
              {t(($) => $['operation.retry'], { ns: 'common' })}
            </Button>
          </AlertActions>
        </Alert>
      </div>
    )
  }

  if (!providerInfo || !triggerEvents.length) return null

  return (
    <div className="px-4 pt-2 pb-4">
      <div className="mb-1 py-1">
        <div className="mb-1 flex h-6 items-center justify-between system-sm-semibold-uppercase text-text-secondary">
          {t(($) => $['events.actionNum'], {
            ns: 'pluginTrigger',
            num: triggerEvents.length,
            event: t(($) => $[`events.${triggerEvents.length > 1 ? 'events' : 'event'}`], {
              ns: 'pluginTrigger',
            }),
          })}
        </div>
      </div>
      <div className="flex flex-col gap-2">
        {triggerEvents.map((triggerEvent: TriggerEvent) => (
          <TriggerEventCard
            key={`${detail?.plugin_id}${triggerEvent.identity?.name || ''}`}
            eventInfo={triggerEvent}
            providerInfo={providerInfo}
          />
        ))}
      </div>
    </div>
  )
}
