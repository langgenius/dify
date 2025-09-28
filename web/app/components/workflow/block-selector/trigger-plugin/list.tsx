'use client'
import { memo, useEffect, useMemo } from 'react'
import { useAllTriggerPlugins } from '@/service/use-triggers'
import TriggerPluginItem from './item'
import type { BlockEnum } from '../../types'
import type { TriggerDefaultValue } from '../types'
import { useGetLanguage } from '@/context/i18n'

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

  const triggerPlugins = useMemo(() => {
    // Follow exact same pattern as tools
    return (triggerPluginsData || []).filter((triggerWithProvider) => {
      if (triggerWithProvider.triggers.length === 0) return false

      // Filter by search text
      if (searchText) {
        const matchesSearch = triggerWithProvider.name.toLowerCase().includes(searchText.toLowerCase())
          || triggerWithProvider.triggers.some(tool =>
            tool.label[language].toLowerCase().includes(searchText.toLowerCase()),
          )
        if (!matchesSearch) return false
      }

      return true
    })
  }, [triggerPluginsData, searchText, language])

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
