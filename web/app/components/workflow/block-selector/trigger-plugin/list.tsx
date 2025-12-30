'use client'
import type { BlockEnum } from '../../types'
import type { TriggerDefaultValue, TriggerWithProvider } from '../types'
import { memo, useEffect, useMemo } from 'react'
import { useGetLanguage } from '@/context/i18n'
import { useAllTriggerPlugins } from '@/service/use-triggers'
import TriggerPluginItem from './item'

type TriggerPluginListProps = {
  onSelect: (type: BlockEnum, trigger?: TriggerDefaultValue) => void
  searchText: string
  onContentStateChange?: (hasContent: boolean) => void
  tags?: string[]
}

const TriggerPluginList = ({
  onSelect,
  searchText,
  onContentStateChange,
}: TriggerPluginListProps) => {
  const { data: triggerPluginsData } = useAllTriggerPlugins()
  const language = useGetLanguage()

  const normalizedSearch = searchText.trim().toLowerCase()
  const triggerPlugins = useMemo(() => {
    const plugins = triggerPluginsData || []
    const getLocalizedText = (text?: Record<string, string> | null) => {
      if (!text)
        return ''

      if (text[language])
        return text[language]

      if (text['en-US'])
        return text['en-US']

      const firstValue = Object.values(text).find(Boolean)
      return (typeof firstValue === 'string') ? firstValue : ''
    }
    const getSearchableTexts = (name: string, label?: Record<string, string> | null) => {
      const localized = getLocalizedText(label)
      const values = [localized, name].filter(Boolean)
      return values.length > 0 ? values : ['']
    }
    const isMatchingKeywords = (value: string) => value.toLowerCase().includes(normalizedSearch)

    if (!normalizedSearch)
      return plugins.filter(triggerWithProvider => triggerWithProvider.events.length > 0)

    return plugins.reduce<TriggerWithProvider[]>((acc, triggerWithProvider) => {
      if (triggerWithProvider.events.length === 0)
        return acc

      const providerMatches = getSearchableTexts(
        triggerWithProvider.name,
        triggerWithProvider.label,
      ).some(text => isMatchingKeywords(text))

      if (providerMatches) {
        acc.push(triggerWithProvider)
        return acc
      }

      const matchedEvents = triggerWithProvider.events.filter((event) => {
        return getSearchableTexts(
          event.name,
          event.label,
        ).some(text => isMatchingKeywords(text))
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

  const hasContent = triggerPlugins.length > 0

  useEffect(() => {
    onContentStateChange?.(hasContent)
  }, [hasContent, onContentStateChange])

  if (!hasContent)
    return null

  return (
    <div className="p-1">
      {triggerPlugins.map(plugin => (
        <TriggerPluginItem
          key={plugin.id}
          payload={plugin}
          onSelect={onSelect}
          hasSearchText={!!searchText}
        />
      ))}
    </div>
  )
}

export default memo(TriggerPluginList)
