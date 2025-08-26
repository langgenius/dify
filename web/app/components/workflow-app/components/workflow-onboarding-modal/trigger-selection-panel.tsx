'use client'
import type { FC } from 'react'
import { RiArrowLeftLine } from '@remixicon/react'
import AllStartBlocks from '@/app/components/workflow/block-selector/all-start-blocks'
import { BlockEnum } from '@/app/components/workflow/types'
import type { ToolDefaultValue } from '@/app/components/workflow/block-selector/types'

type TriggerSelectionPanelProps = {
  onSelect: (nodeType: BlockEnum, toolConfig?: ToolDefaultValue) => void
  onBack: () => void
}

const TRIGGER_NODE_TYPES = [
  BlockEnum.TriggerSchedule,
  BlockEnum.TriggerWebhook,
  BlockEnum.TriggerPlugin,
] as const

const TriggerSelectionPanel: FC<TriggerSelectionPanelProps> = ({
  onSelect,
  onBack,
}) => {
  const handleSelect = (type: BlockEnum, toolConfig?: ToolDefaultValue) => {
    if (type !== BlockEnum.Start)
      onSelect(type, toolConfig)
  }

  return (
    <div className="flex h-[600px] w-[500px] flex-col">
      <div className="flex items-center border-b border-divider-subtle p-4">
        <button
          onClick={onBack}
          className="mr-3 flex h-6 w-6 cursor-pointer items-center justify-center rounded-md text-text-tertiary hover:bg-state-base-hover hover:text-text-secondary"
        >
          <RiArrowLeftLine className="h-4 w-4" />
        </button>
        <h3 className="title-lg-semi-bold text-text-primary">
          Select Trigger
        </h3>
      </div>

      <div className="flex-1 overflow-hidden">
        <AllStartBlocks
          className="border-0"
          searchText=""
          onSelect={handleSelect}
          availableBlocksTypes={TRIGGER_NODE_TYPES as unknown as BlockEnum[]}
        />
      </div>
    </div>
  )
}

export default TriggerSelectionPanel
