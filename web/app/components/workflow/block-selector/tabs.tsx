import type { FC } from 'react'
import { memo } from 'react'
import { useAllBuiltInTools, useAllCustomTools, useAllWorkflowTools } from '@/service/use-tools'
import type { BlockEnum } from '../types'
import type { ToolDefaultValue } from './types'
import { TabsEnum } from './types'
import Blocks from './blocks'
import AllTools from './all-tools'

export type TabsProps = {
  activeTab: TabsEnum
  searchText: string
  tags: string[]
  onSelect: (type: BlockEnum, tool?: ToolDefaultValue) => void
  availableBlocksTypes?: BlockEnum[]
  noBlocks?: boolean
}
const Tabs: FC<TabsProps> = ({
  activeTab,
  tags,
  searchText,
  onSelect,
  availableBlocksTypes,
  noBlocks,
}) => {
  const { data: buildInTools } = useAllBuiltInTools()
  const { data: customTools } = useAllCustomTools()
  const { data: workflowTools } = useAllWorkflowTools()

  return (
    <div onClick={e => e.stopPropagation()}>
      {
        activeTab === TabsEnum.Blocks && !noBlocks && (
          <Blocks
            searchText={searchText}
            onSelect={onSelect}
            availableBlocksTypes={availableBlocksTypes}
          />
        )
      }
      {
        activeTab === TabsEnum.Tools && (
          <AllTools
            className='w-[315px]'
            searchText={searchText}
            onSelect={onSelect}
            tags={tags}
            buildInTools={buildInTools || []}
            customTools={customTools || []}
            workflowTools={workflowTools || []}
          />
        )
      }
    </div>
  )
}

export default memo(Tabs)
