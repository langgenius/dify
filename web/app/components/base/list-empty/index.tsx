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
    <div className="flex w-[320px] flex-col items-start gap-2 radius-lg bg-workflow-process-bg p-4">
      <div className="flex h-10 w-10 items-center justify-center gap-2 radius-lg">
        <div className="relative flex grow items-center justify-center gap-2 self-stretch radius-lg border-[0.5px]
          border-components-card-border bg-components-card-bg p-1 shadow-lg"
        >
          {icon || <Variable02 className="h-5 w-5 shrink-0 text-text-accent" />}
          <VerticalLine className="absolute -right-px top-1/2 -translate-y-1/4" />
          <VerticalLine className="absolute -left-px top-1/2 -translate-y-1/4" />
          <HorizontalLine className="absolute left-3/4 top-0 -translate-x-1/4 -translate-y-1/2" />
          <HorizontalLine className="absolute left-3/4 top-full -translate-x-1/4 -translate-y-1/2" />
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
