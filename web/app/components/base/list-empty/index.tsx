import type { ReactNode } from 'react'
import React from 'react'
import { Variable02 } from '../icons/src/vender/solid/development'
import VerticalLine from './vertical-line'
import HorizontalLine from './horizontal-line'

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
    <div className='bg-workflow-process-bg flex w-[320px] flex-col items-start gap-2 rounded-[10px] p-4'>
      <div className='flex h-10 w-10 items-center justify-center gap-2 rounded-[10px]'>
        <div className='border-components-card-border bg-components-card-bg relative flex grow items-center justify-center gap-2 self-stretch
          rounded-[10px] border-[0.5px] p-1 shadow-lg'>
          {icon || <Variable02 className='text-text-accent h-5 w-5 shrink-0' />}
          <VerticalLine className='absolute -right-[1px] top-1/2 -translate-y-1/4'/>
          <VerticalLine className='absolute -left-[1px] top-1/2 -translate-y-1/4'/>
          <HorizontalLine className='absolute left-3/4 top-0 -translate-x-1/4 -translate-y-1/2'/>
          <HorizontalLine className='absolute left-3/4 top-full -translate-x-1/4 -translate-y-1/2' />
        </div>
      </div>
      <div className='flex flex-col items-start gap-1 self-stretch'>
        <div className='text-text-secondary system-sm-medium'>{title}</div>
        {description}
      </div>
    </div>
  )
}

export default ListEmpty
