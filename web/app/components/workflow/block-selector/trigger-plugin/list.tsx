'use client'
import { memo, useEffect, useMemo } from 'react'
import { useAllTriggerPlugins } from '@/service/use-triggers'
import TriggerPluginItem from './item'
import type { BlockEnum } from '../../types'
import type { TriggerDefaultValue, TriggerWithProvider } from '../types'

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

  const normalizedSearch = searchText.trim().toLowerCase()
  const triggerPlugins = useMemo(() => {
    const plugins = triggerPluginsData || []

    if (!normalizedSearch)
      return plugins.filter(triggerWithProvider => triggerWithProvider.events.length > 0)

    return plugins.reduce<TriggerWithProvider[]>((acc, triggerWithProvider) => {
      if (triggerWithProvider.events.length === 0)
        return acc

      const providerMatches = triggerWithProvider.name.toLowerCase().includes(normalizedSearch)

      if (providerMatches) {
        acc.push(triggerWithProvider)
        return acc
      }

      const matchedEvents = triggerWithProvider.events.filter((event) => {
        return event.name.toLowerCase().includes(normalizedSearch)
      })

      if (matchedEvents.length > 0) {
        acc.push({
          ...triggerWithProvider,
          events: matchedEvents,
        })
      }

      return acc
    }, [])
  }, [triggerPluginsData, normalizedSearch])

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
