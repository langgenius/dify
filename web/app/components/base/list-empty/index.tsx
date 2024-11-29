import React from 'react'
import { Variable02 } from '../icons/src/vender/solid/development'
import VerticalLine from './vertical-line'
import HorizontalLine from './horizontal-line'

type ListEmptyProps = {
  title?: string
  description?: React.ReactNode
}

const ListEmpty = ({
  title,
  description,
}: ListEmptyProps) => {
  return (
    <div className='flex w-[320px] p-4 flex-col items-start gap-2 rounded-[10px] bg-workflow-process-bg'>
      <div className='flex w-10 h-10 justify-center items-center gap-2 rounded-[10px]'>
        <div className='flex relative p-1 justify-center items-center gap-2 grow self-stretch rounded-[10px]
          border-[0.5px] border-components-card-border bg-components-card-bg shadow-lg'>
          <Variable02 className='w-5 h-5 shrink-0 text-text-accent' />
          <VerticalLine className='absolute -right-[1px] top-1/2 -translate-y-1/4'/>
          <VerticalLine className='absolute -left-[1px] top-1/2 -translate-y-1/4'/>
          <HorizontalLine className='absolute top-0 left-3/4 -translate-x-1/4 -translate-y-1/2'/>
          <HorizontalLine className='absolute top-full left-3/4 -translate-x-1/4 -translate-y-1/2' />
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
