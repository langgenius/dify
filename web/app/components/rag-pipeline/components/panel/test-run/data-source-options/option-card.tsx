import React from 'react'
import cn from '@/utils/classnames'
import BlockIcon from '@/app/components/workflow/block-icon'
import { BlockEnum } from '@/app/components/workflow/types'
import type { DataSourceNodeType } from '@/app/components/workflow/nodes/data-source/types'
import { useToolIcon } from '@/app/components/workflow/hooks'

type OptionCardProps = {
  label: string
  selected: boolean
  nodeData: DataSourceNodeType
  onClick?: () => void
}

const OptionCard = ({
  label,
  selected,
  nodeData,
  onClick,
}: OptionCardProps) => {
  const toolIcon = useToolIcon(nodeData)

  return (
    <div
      className={cn(
        'flex flex-col gap-1 rounded-xl border border-components-option-card-option-border bg-components-option-card-option-bg p-2.5 shadow-shadow-shadow-3',
        selected
          ? 'border-components-option-card-option-selected-border bg-components-option-card-option-selected-bg shadow-xs ring-[0.5px] ring-inset ring-components-option-card-option-selected-border'
          : 'hover:bg-components-option-card-bg-hover hover:border-components-option-card-option-border-hover hover:shadow-xs',
      )}
      onClick={onClick}
    >
      <div className='flex size-7 items-center justify-center rounded-lg border-[0.5px] border-components-panel-border bg-background-default-dodge p-1'>
        <BlockIcon
          type={BlockEnum.DataSource}
          toolIcon={toolIcon}
        />
      </div>
      <div className={cn('system-sm-medium text-text-secondary', selected && 'text-primary')}>
        {label}
      </div>
    </div>
  )
}

export default React.memo(OptionCard)
