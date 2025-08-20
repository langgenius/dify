'use client'
import { memo, useMemo } from 'react'
import { useAllBuiltInTools } from '@/service/use-tools'
import Tools from './tools'
import type { BlockEnum } from '../types'
import type { ToolDefaultValue } from './types'
import { ViewType } from './view-type-select'
import { useGetLanguage } from '@/context/i18n'

type TriggerPluginSelectorProps = {
  onSelect: (type: BlockEnum, tool?: ToolDefaultValue) => void
  searchText: string
}

const TriggerPluginSelector = ({
  onSelect,
  searchText,
}: TriggerPluginSelectorProps) => {
  const language = useGetLanguage()
  const { data: buildInTools = [] } = useAllBuiltInTools()

  // Filter plugins that support trigger functionality
  const triggerPlugins = useMemo(() => {
    return buildInTools.filter((toolWithProvider) => {
      // For now, assume all plugins can be triggers
      // This will be refined when backend provides trigger capability info
      return toolWithProvider.tools.length > 0
    }).filter((toolWithProvider) => {
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
    <div className="border-t border-divider-subtle">
      <Tools
        tools={triggerPlugins}
        onSelect={onSelect}
        viewType={ViewType.flat}
        hasSearchText={!!searchText}
        canNotSelectMultiple
      />
    </div>
  )
}

export default memo(TriggerPluginSelector)
