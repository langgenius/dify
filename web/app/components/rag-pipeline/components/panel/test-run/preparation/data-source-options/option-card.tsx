import React, { useCallback } from 'react'
import cn from '@/utils/classnames'
import BlockIcon from '@/app/components/workflow/block-icon'
import { BlockEnum } from '@/app/components/workflow/types'
import type { DataSourceNodeType } from '@/app/components/workflow/nodes/data-source/types'
import { useToolIcon } from '@/app/components/workflow/hooks'

type OptionCardProps = {
  label: string
  value: string
  selected: boolean
  nodeData: DataSourceNodeType
  onClick?: (value: string) => void
}

const OptionCard = ({
  label,
  value,
  selected,
  nodeData,
  onClick,
}: OptionCardProps) => {
  const toolIcon = useToolIcon(nodeData)

  const handleClickCard = useCallback(() => {
    onClick?.(value)
  }, [value, onClick])

  return (
    <div
      className={cn(
        'flex cursor-pointer flex-col gap-1 rounded-xl border border-components-option-card-option-border bg-components-option-card-option-bg p-2.5 shadow-shadow-shadow-3',
        selected
          ? 'border-components-option-card-option-selected-border bg-components-option-card-option-selected-bg shadow-xs ring-[0.5px] ring-inset ring-components-option-card-option-selected-border'
          : 'hover:bg-components-option-card-bg-hover hover:border-components-option-card-option-border-hover hover:shadow-xs',
      )}
      onClick={handleClickCard}
    >
      <div className='flex size-7 shrink-0 items-center justify-center rounded-lg border-[0.5px] border-components-panel-border bg-background-default-dodge p-1'>
        <BlockIcon
          type={BlockEnum.DataSource}
          toolIcon={toolIcon}
        />
      </div>
      <div
        className={cn('system-sm-medium line-clamp-2 grow text-text-secondary', selected && 'text-text-primary')}
        title={label}
      >
        {label}
      </div>
    </div>
  )
}

export default React.memo(OptionCard)
