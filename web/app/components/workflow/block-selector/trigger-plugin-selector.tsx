'use client'
import { memo } from 'react'
import TriggerPluginList from './trigger-plugin/list'
import type { BlockEnum } from '../types'
import type { ToolDefaultValue } from './types'

type TriggerPluginSelectorProps = {
  onSelect: (type: BlockEnum, tool?: ToolDefaultValue) => void
  searchText: string
  onContentStateChange?: (hasContent: boolean) => void
  tags?: string[]
}

const TriggerPluginSelector = ({
  onSelect,
  searchText,
  onContentStateChange,
  tags = [],
}: TriggerPluginSelectorProps) => {
  return (
    <TriggerPluginList
      onSelect={onSelect}
      searchText={searchText}
      onContentStateChange={onContentStateChange}
      tags={tags}
    />
  )
}

export default memo(TriggerPluginSelector)
