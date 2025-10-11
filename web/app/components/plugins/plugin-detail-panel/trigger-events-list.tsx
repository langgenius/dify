import React, { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useContextSelector } from 'use-context-selector'
import I18n from '@/context/i18n'
import { getLanguage } from '@/i18n-config/language'
import ToolItem from '@/app/components/tools/provider/tool-item'
import { useTriggerProviderInfo } from '@/service/use-triggers'
import type { Tool, ToolParameter } from '@/app/components/tools/types'
import { CollectionType } from '@/app/components/tools/types'
import type { ToolWithProvider } from '@/app/components/workflow/types'
import type { TypeWithI18N } from '@/app/components/header/account-setting/model-provider-page/declarations'
import type { Trigger } from '@/app/components/plugins/types'
import { usePluginStore } from './subscription-list/store'

type TriggerOption = {
  value: string
  label: TypeWithI18N
  icon?: string | null
}

const pickLocaleText = (value?: TypeWithI18N | string, fallback = '', language = 'en_US'): string => {
  if (!value)
    return fallback
  if (typeof value === 'string')
    return value
  const typedValue = value as Record<string, string>
  return typedValue[language] ?? typedValue.en_US ?? Object.values(typedValue)[0] ?? fallback
}

const getTriggerDescription = (description: TypeWithI18N | { human?: TypeWithI18N | string } | string | undefined, language = 'en_US'): string => {
  if (!description)
    return ''

  if (typeof description === 'string')
    return description

  if (typeof description === 'object' && 'human' in description) {
    const human = (description as { human?: TypeWithI18N | string }).human
    return pickLocaleText(human, '', language)
  }

  return pickLocaleText(description as TypeWithI18N, '', language)
}

const toToolParameter = (parameter: any): ToolParameter => {
  const paramLabel = parameter.label as TypeWithI18N
  const paramDescription = parameter.description as TypeWithI18N | undefined

  return {
    name: parameter.name,
    label: paramLabel,
    human_description: paramDescription || paramLabel,
    type: parameter.type,
    form: 'setting',
    llm_description: typeof paramDescription === 'object' ? (paramDescription?.en_US || '') : (paramDescription || ''),
    required: parameter.required ?? false,
    multiple: parameter.multiple ?? false,
    default: parameter.default ?? '',
    options: parameter.options?.map((option: TriggerOption) => ({
      label: option.label,
      value: option.value,
    })) || [],
  }
}

const toTool = (trigger: Trigger, fallbackAuthor: string): Tool => {
  const name = trigger.identity?.name || ''
  const label = trigger.identity?.label || { en_US: name }
  const description = trigger.description?.human || trigger.description || { en_US: '' }
  return {
    name,
    author: trigger.identity?.author || fallbackAuthor,
    label: label as TypeWithI18N,
    description: description as TypeWithI18N,
    parameters: (trigger.parameters || []).map((param: any) => toToolParameter(param)),
    labels: [],
    output_schema: trigger.output_schema || {},
  }
}

export const TriggerEventsList = () => {
  const { t } = useTranslation()
  const locale = useContextSelector(I18n, state => state.locale)
  const language = getLanguage(locale)
  const detail = usePluginStore(state => state.detail)
  const events = detail?.declaration.trigger?.events || []

  const { data: providerInfo } = useTriggerProviderInfo(detail?.provider || '')

  const collection = useMemo<ToolWithProvider | undefined>(() => {
    if (!detail || !providerInfo)
      return undefined

    const tools = (providerInfo.events || []).map((trigger: any) => toTool(trigger, providerInfo.author))

    const metaVersion = detail.declaration.meta?.version || detail.declaration.version || '1.0'

    return {
      id: providerInfo.plugin_id || providerInfo.name,
      name: providerInfo.name,
      author: providerInfo.author,
      description: providerInfo.description,
      icon: providerInfo.icon || providerInfo.icon_dark || '',
      label: providerInfo.label,
      type: CollectionType.builtIn,
      team_credentials: {},
      is_team_authorization: false,
      allow_delete: false,
      labels: providerInfo.tags || [],
      plugin_id: providerInfo.plugin_id || detail.plugin_id,
      tools,
      meta: { version: metaVersion },
    }
  }, [detail, providerInfo])

  if (!events.length)
    return null

  return (
    <div className='px-4 pb-4 pt-2'>
      <div className='mb-1 py-1'>
        <div className='system-sm-semibold-uppercase mb-1 flex h-6 items-center justify-between text-text-secondary'>
          {t('pluginTrigger.events.actionNum', { num: events.length, event: t(`pluginTrigger.events.${events.length > 1 ? 'events' : 'event'}`) })}
        </div>
      </div>
      <div className='flex flex-col gap-2'>
        {collection
          ? events.map((triggerEvent: Trigger) => {
            const triggerName = triggerEvent.identity?.name || ''
            const tool = collection.tools.find(item => item.name === triggerName)
              || toTool(triggerEvent, collection.author)

            return (
              <ToolItem
                key={`${detail?.plugin_id}${triggerEvent.identity?.name || ''}`}
                disabled={false}
                collection={collection}
                tool={tool}
                isBuiltIn={false}
                isModel={false}
              />
            )
          })
          : events.map((triggerEvent: Trigger) => (
            <div
              key={`${detail?.plugin_id}${triggerEvent.identity?.name || ''}`}
              className='bg-components-panel-item-bg rounded-xl border-[0.5px] border-components-panel-border-subtle px-4 py-3 shadow-xs'
            >
              <div className='system-md-semibold pb-0.5 text-text-secondary'>
                {pickLocaleText(triggerEvent.identity?.label as TypeWithI18N, triggerEvent.identity?.name || '', language)}
              </div>
              <div className='system-xs-regular line-clamp-2 text-text-tertiary'>
                {getTriggerDescription(triggerEvent.description, language)}
              </div>
            </div>
          ))}
      </div>
    </div>
  )
}
