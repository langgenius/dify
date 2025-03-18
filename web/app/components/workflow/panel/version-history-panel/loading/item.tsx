import React, { type FC } from 'react'
import cn from '@/utils/classnames'

type ItemProps = {
  titleWidth: string
  releaseNotesWidth: string
  isFirst: boolean
  isLast: boolean
}

const Item: FC<ItemProps> = ({
  titleWidth,
  releaseNotesWidth,
  isFirst,
  isLast,
}) => {
  return (
    <div className='flex gap-x-1 relative p-2' >
      {!isLast && <div className='absolute w-0.5 h-[calc(100%-0.75rem)] left-4 top-6 bg-divider-subtle' />}
      <div className=' flex items-center justify-center shrink-0 w-[18px] h-5'>
        <div className='w-2 h-2 border-[2px] rounded-lg border-text-quaternary' />
      </div>
      <div className='flex flex-col grow gap-y-0.5'>
        <div className='flex items-center h-3.5'>
          <div className={cn('h-2 w-full bg-text-quaternary rounded-sm opacity-20', titleWidth)} />
        </div>
        {
          !isFirst && (
            <div className='flex items-center h-3'>
              <div className={cn('h-1.5 w-full bg-text-quaternary rounded-sm opacity-20', releaseNotesWidth)} />
            </div>
          )
        }
      </div>
    </div>

  )
}

export default React.memo(Item)
