'use client'
import { memo, useEffect, useMemo } from 'react'
import { useAllBuiltInTools } from '@/service/use-tools'
import TriggerPluginItem from './item'
import type { BlockEnum } from '../../types'
import type { ToolDefaultValue } from '../types'
import { useGetLanguage } from '@/context/i18n'

type TriggerPluginListProps = {
  onSelect: (type: BlockEnum, tool?: ToolDefaultValue) => void
  searchText: string
  onContentStateChange?: (hasContent: boolean) => void
}

const TriggerPluginList = ({
  onSelect,
  searchText,
  onContentStateChange,
}: TriggerPluginListProps) => {
  const { data: buildInTools = [] } = useAllBuiltInTools()
  const language = useGetLanguage()

  const triggerPlugins = useMemo(() => {
    return buildInTools.filter((toolWithProvider) => {
      if (toolWithProvider.tools.length === 0) return false

      if (!searchText) return true

      return toolWithProvider.name.toLowerCase().includes(searchText.toLowerCase())
        || toolWithProvider.tools.some(tool =>
          tool.label[language].toLowerCase().includes(searchText.toLowerCase()),
        )
    })
  }, [buildInTools, searchText, language])

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
