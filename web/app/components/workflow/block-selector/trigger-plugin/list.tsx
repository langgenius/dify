'use client'
import { memo, useEffect, useMemo } from 'react'
import { useAllTriggerPlugins } from '@/service/use-triggers'
import TriggerPluginItem from './item'
import type { BlockEnum } from '../../types'
import type { ToolDefaultValue } from '../types'
import { useGetLanguage } from '@/context/i18n'

type TriggerPluginListProps = {
  onSelect: (type: BlockEnum, tool?: ToolDefaultValue) => void
  searchText: string
  onContentStateChange?: (hasContent: boolean) => void
  tags?: string[]
}

const TriggerPluginList = ({
  onSelect,
  searchText,
  onContentStateChange,
  tags = [],
}: TriggerPluginListProps) => {
  const { data: triggerPluginsData } = useAllTriggerPlugins()
  const language = useGetLanguage()

  const triggerPlugins = useMemo(() => {
    // Follow exact same pattern as tools
    return (triggerPluginsData || []).filter((toolWithProvider) => {
      if (toolWithProvider.tools.length === 0) return false

      // Filter by search text
      if (searchText) {
        const matchesSearch = toolWithProvider.name.toLowerCase().includes(searchText.toLowerCase())
          || toolWithProvider.tools.some(tool =>
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
