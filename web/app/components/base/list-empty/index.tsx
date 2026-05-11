import type { ReactNode } from 'react'
import * as React from 'react'
import { Variable02 } from '../icons/src/vender/solid/development'
import HorizontalLine from './horizontal-line'
import VerticalLine from './vertical-line'

type ListEmptyProps = {
  title?: string
  description?: ReactNode
  icon?: ReactNode
}

const ListEmpty = ({
  title,
  description,
  icon,
}: ListEmptyProps) => {
  return (
    <div className="flex w-[320px] flex-col items-start gap-2 rounded-[10px] bg-workflow-process-bg p-4">
      <div className="flex h-10 w-10 items-center justify-center gap-2 rounded-[10px]">
        <div className="relative flex grow items-center justify-center gap-2 self-stretch rounded-[10px] border-[0.5px]
          border-components-card-border bg-components-card-bg p-1 shadow-lg"
        >
          {icon || <Variable02 className="h-5 w-5 shrink-0 text-text-accent" />}
          <VerticalLine className="absolute top-1/2 -right-px -translate-y-1/4" />
          <VerticalLine className="absolute top-1/2 -left-px -translate-y-1/4" />
          <HorizontalLine className="absolute top-0 left-3/4 -translate-x-1/4 -translate-y-1/2" />
          <HorizontalLine className="absolute top-full left-3/4 -translate-x-1/4 -translate-y-1/2" />
        </div>
      </div>
      <div className="flex flex-col items-start gap-1 self-stretch">
        <div className="system-sm-medium text-text-secondary">{title}</div>
        {description}
      </div>
    </div>
  )
}

export default ListEmpty
