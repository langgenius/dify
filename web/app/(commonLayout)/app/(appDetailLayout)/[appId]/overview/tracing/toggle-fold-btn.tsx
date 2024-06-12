'use client'
import { ChevronDoubleDownIcon } from '@heroicons/react/20/solid'
import type { FC } from 'react'
import React from 'react'

type Props = {
  isFold: boolean
  onFoldChange: (isFold: boolean) => void
}

const ToggleFoldBtn: FC<Props> = ({
  isFold,
  onFoldChange,
}) => {
  return (
    <div className='shrink-0 cursor-pointer'>
      {isFold && (
        <div className='p-1 rounded-md text-gray-500 hover:text-gray-800 hover:bg-black/5'>
          <ChevronDoubleDownIcon className='w-4 h-4' />
        </div>
      )}
      {!isFold && (
        <div className='p-2 rounded-lg text-gray-500 hover:text-gray-800 hover:bg-black/5'>
          <ChevronDoubleDownIcon className='w-4 h-4 transform rotate-180' />
        </div>
      )}
    </div>
  )
}
export default React.memo(ToggleFoldBtn)
