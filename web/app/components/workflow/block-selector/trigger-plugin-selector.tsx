'use client'
import { memo } from 'react'
import TriggerPluginList from './trigger-plugin/list'
import type { BlockEnum } from '../types'
import type { ToolDefaultValue } from './types'

type TriggerPluginSelectorProps = {
  onSelect: (type: BlockEnum, tool?: ToolDefaultValue) => void
  searchText: string
  onContentStateChange?: (hasContent: boolean) => void
}

const TriggerPluginSelector = ({
  onSelect,
  searchText,
  onContentStateChange,
}: TriggerPluginSelectorProps) => {
  return (
    <TriggerPluginList
      onSelect={onSelect}
      searchText={searchText}
      onContentStateChange={onContentStateChange}
    />
  )
}

export default memo(TriggerPluginSelector)
