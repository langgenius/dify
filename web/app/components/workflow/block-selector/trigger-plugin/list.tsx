'use client'
import type { BlockEnum } from '../../types'
import type { TriggerDefaultValue, TriggerWithProvider } from '../types'
import type { TriggerPluginActionPreviewPayload } from './action-item'
import { Button } from '@langgenius/dify-ui/button'
import { createPreviewCardHandle, PreviewCard } from '@langgenius/dify-ui/preview-card'
import { useQuery } from '@tanstack/react-query'
import { memo, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useGetLanguage } from '@/context/i18n'
import { allTriggerPluginsQueryOptions } from '@/service/trigger-queries'
import { useOwnedQueryError } from '@/service/use-owned-query-error'
import { useRequestErrorMessage } from '@/service/use-request-error-message'
import { TriggerPluginActionPreviewCard } from './action-item'
import TriggerPluginItem from './item'

type TriggerPluginListProps = {
  onSelect: (type: BlockEnum, trigger?: TriggerDefaultValue) => void
  searchText: string
  onContentStateChange?: (hasContent: boolean) => void
  tags?: string[]
  disabled?: boolean
}

const TriggerPluginList = ({
  onSelect,
  searchText,
  onContentStateChange,
  disabled = false,
}: TriggerPluginListProps) => {
  const { t } = useTranslation(['workflow', 'common'])
  const triggerPluginsQuery = useQuery(allTriggerPluginsQueryOptions())
  const triggerPluginsData = triggerPluginsQuery.data
  const triggerPluginsLoad = useOwnedQueryError(triggerPluginsQuery)
  const loadErrorMessage = useRequestErrorMessage(
    triggerPluginsLoad?.error,
    t(($) => $['common.loadFailed'], { ns: 'workflow' }),
  )
  const language = useGetLanguage()
  const [previewCardHandle] = useState(() =>
    createPreviewCardHandle<TriggerPluginActionPreviewPayload>(),
  )

  const normalizedSearch = searchText.trim().toLowerCase()
  const triggerPlugins = useMemo(() => {
    const plugins = triggerPluginsData || []
    const getLocalizedText = (text?: Record<string, string> | null) => {
      if (!text) return ''

      if (text[language]) return text[language]

      if (text['en-US']) return text['en-US']

      const firstValue = Object.values(text).find(Boolean)
      return typeof firstValue === 'string' ? firstValue : ''
    }
    const getSearchableTexts = (name: string, label?: Record<string, string> | null) => {
      const localized = getLocalizedText(label)
      const values = [localized, name].filter(Boolean)
      return values.length > 0 ? values : ['']
    }
    const isMatchingKeywords = (value: string) => value.toLowerCase().includes(normalizedSearch)

    if (!normalizedSearch)
      return plugins.filter((triggerWithProvider) => triggerWithProvider.events.length > 0)

    return plugins.reduce<TriggerWithProvider[]>((acc, triggerWithProvider) => {
      if (triggerWithProvider.events.length === 0) return acc

      const providerMatches = getSearchableTexts(
        triggerWithProvider.name,
        triggerWithProvider.label,
      ).some((text) => isMatchingKeywords(text))

      if (providerMatches) {
        acc.push(triggerWithProvider)
        return acc
      }

      const matchedEvents = triggerWithProvider.events.filter((event) => {
        return getSearchableTexts(event.name, event.label).some((text) => isMatchingKeywords(text))
      })

      if (matchedEvents.length > 0) {
        acc.push({
          ...triggerWithProvider,
          events: matchedEvents,
        })
      }

      return acc
    }, [])
  }, [triggerPluginsData, normalizedSearch, language])

  const hasContent = triggerPlugins.length > 0 || !!triggerPluginsLoad

  useEffect(() => {
    onContentStateChange?.(hasContent)
  }, [hasContent, onContentStateChange])

  if (triggerPluginsLoad) {
    return (
      <div
        role="alert"
        className="flex items-center gap-1 px-3 py-2 system-xs-regular text-text-destructive"
      >
        <span className="min-w-0 wrap-break-word">{loadErrorMessage}</span>
        <Button
          size="small"
          variant="ghost"
          loading={triggerPluginsLoad.retrying}
          onClick={triggerPluginsLoad.retry}
        >
          {t(($) => $['operation.retry'], { ns: 'common' })}
        </Button>
      </div>
    )
  }

  if (!hasContent) return null

  return (
    <div className="p-1">
      {triggerPlugins.map((plugin) => (
        <TriggerPluginItem
          key={plugin.id}
          payload={plugin}
          onSelect={onSelect}
          disabled={disabled}
          hasSearchText={!!searchText}
          previewCardHandle={previewCardHandle}
        />
      ))}
      <PreviewCard handle={previewCardHandle}>
        {({ payload }) => <TriggerPluginActionPreviewCard payload={payload} />}
      </PreviewCard>
    </div>
  )
}

export default memo(TriggerPluginList)
