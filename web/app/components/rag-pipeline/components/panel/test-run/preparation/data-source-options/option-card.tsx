import type { DataSourceNodeType } from '@/app/components/workflow/nodes/data-source/types'
import { cn } from '@langgenius/dify-ui/cn'
import { RadioItem } from '@langgenius/dify-ui/radio-group'
import * as React from 'react'
import BlockIcon from '@/app/components/workflow/block-icon'
import { useToolIcon } from '@/app/components/workflow/hooks/use-tool-icon'
import { BlockEnum } from '@/app/components/workflow/types'

type OptionCardProps = {
  label: string
  value: string
  selected: boolean
  nodeData: DataSourceNodeType
}

const OptionCard = ({ label, value, selected, nodeData }: OptionCardProps) => {
  const toolIcon = useToolIcon(nodeData)

  return (
    <RadioItem
      value={value}
      className={cn(
        'flex cursor-pointer flex-col gap-1 rounded-xl border border-components-option-card-option-border bg-components-option-card-option-bg p-2.5 text-left shadow-shadow-shadow-3 focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden',
        selected
          ? 'border-components-option-card-option-selected-border bg-components-option-card-option-selected-bg shadow-xs inset-ring-[0.5px] inset-ring-components-option-card-option-selected-border'
          : 'hover:border-components-option-card-option-border-hover hover:shadow-xs',
      )}
    >
      <div
        aria-hidden="true"
        className="flex size-7 shrink-0 items-center justify-center rounded-lg border-[0.5px] border-components-panel-border bg-background-default-dodge p-1"
      >
        <BlockIcon type={BlockEnum.DataSource} toolIcon={toolIcon} />
      </div>
      <div
        className={cn(
          'line-clamp-2 grow system-sm-medium text-text-secondary',
          selected && 'text-text-primary',
        )}
        title={label}
      >
        {label}
      </div>
    </RadioItem>
  )
}

export default React.memo(OptionCard)
