'use client'
import { memo } from 'react'
import TriggerPluginList from './trigger-plugin/list'
import type { BlockEnum } from '../types'
import type { ToolDefaultValue } from './types'

type TriggerPluginSelectorProps = {
  onSelect: (type: BlockEnum, tool?: ToolDefaultValue) => void
  searchText: string
}

const TriggerPluginSelector = ({
  onSelect,
  searchText,
}: TriggerPluginSelectorProps) => {
  return (
    <TriggerPluginList
      onSelect={onSelect}
      searchText={searchText}
    />
  )
}

export default memo(TriggerPluginSelector)
