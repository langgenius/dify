'use client'
import type { FC } from 'react'
import React from 'react'
import { ClockPlay } from '@/app/components/base/icons/src/vender/line/time'
import Button from '@/app/components/base/button'
import { RiPlayLine } from '@remixicon/react'

type Props = {
  onSingleRun: () => void
}

const NoData: FC<Props> = ({
  onSingleRun,
}) => {
  return (
    <div className='flex h-0 grow flex-col items-center justify-center'>
      <ClockPlay className='h-8 w-8 text-text-quaternary' />
      <div className='system-xs-regular my-2 text-text-tertiary'>The results of the last run will be displayed here</div>
      <Button
        className='flex'
        size='small'
        onClick={onSingleRun}
      >
        <RiPlayLine className='mr-1 h-3.5 w-3.5' />
        <div>Run this node</div>
      </Button>
    </div>
  )
}
export default React.memo(NoData)
