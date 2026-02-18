import type { DataSourceNodeType } from '@/app/components/workflow/nodes/data-source/types'
import * as React from 'react'
import { cn } from '@/utils/classnames'
import DatasourceIcon from './datasource-icon'
import { useDatasourceIcon } from './hooks'

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
  const iconUrl = useDatasourceIcon(nodeData) as string

  return (
    <div
      className={cn(
        'flex cursor-pointer items-center gap-2 rounded-xl border border-components-option-card-option-border bg-components-option-card-option-bg p-3 shadow-shadow-shadow-3',
        selected
          ? 'border-components-option-card-option-selected-border bg-components-option-card-option-selected-bg shadow-xs ring-[0.5px] ring-inset ring-components-option-card-option-selected-border'
          : 'hover:bg-components-option-card-bg-hover hover:border-components-option-card-option-border-hover hover:shadow-xs',
      )}
      onClick={onClick}
    >
      <div className="flex size-8 shrink-0 items-center justify-center rounded-lg border-[0.5px] border-components-panel-border bg-background-default-dodge p-1.5">
        <DatasourceIcon iconUrl={iconUrl} />
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
