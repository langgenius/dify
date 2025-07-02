'use client'
import { RiBookOpenLine } from '@remixicon/react'
import type { FC } from 'react'
import React from 'react'

const Tip: FC = () => {
  return (
    <div className='w-[316px] rounded-xl bg-background-section p-6'>
      <div className='rounded-[10px] border-[0.5px] border-components-card-border p-2 shadow-lg'>
        <RiBookOpenLine className='size-5 text-text-accent' />
      </div>
    </div>
  )
}
export default React.memo(Tip)
