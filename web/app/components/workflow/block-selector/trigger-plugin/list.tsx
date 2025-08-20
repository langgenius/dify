'use client'
import { memo, useMemo } from 'react'
import { useAllBuiltInTools } from '@/service/use-tools'
import TriggerPluginItem from './item'
import type { BlockEnum } from '../../types'
import type { ToolDefaultValue } from '../types'
import { useGetLanguage } from '@/context/i18n'

type TriggerPluginListProps = {
  onSelect: (type: BlockEnum, tool?: ToolDefaultValue) => void
  searchText: string
}

const TriggerPluginList = ({
  onSelect,
  searchText,
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

  if (!triggerPlugins.length)
    return null

  return (
    <div className="border-t border-divider-subtle p-1">
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
