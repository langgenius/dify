import React from 'react'
import { useTranslation } from 'react-i18next'
import ToolItem from '@/app/components/tools/provider/tool-item'
import { usePluginStore } from './store'

export const TriggerEventsList = () => {
  const { t } = useTranslation()
  const detail = usePluginStore(state => state.detail)
  const triggers = detail?.declaration.trigger?.triggers || []

  if (!triggers.length)
    return null

  // todo: add collection & update ToolItem
  return (
    <div className='px-4 pb-4 pt-2'>
      <div className='mb-1 py-1'>
        <div className='system-sm-semibold-uppercase mb-1 flex h-6 items-center justify-between text-text-secondary'>
          {t('pluginTrigger.events.actionNum', { num: triggers.length, event: triggers.length > 1 ? 'events' : 'event' })}
        </div>
      </div>
      <div className='flex flex-col gap-2'>
        {triggers.map(triggerEvent => (
          <ToolItem
            key={`${detail?.plugin_id}${triggerEvent.identity.name}`}
            disabled={false}
            // collection={provider}
            // @ts-expect-error triggerEvent.identity.label is Record<Locale, string>
            tool={{
              label: triggerEvent.identity.label as any,
              description: triggerEvent.description.human,
            }}
            isBuiltIn={false}
            isModel={false}
          />
        ))}
      </div>
    </div>
  )
}
