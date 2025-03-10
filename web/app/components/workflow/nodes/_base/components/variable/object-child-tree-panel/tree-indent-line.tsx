'use client'
import type { FC } from 'react'
import React from 'react'

type Props = {
  depth?: number
}

const TreeIndentLine: FC<Props> = ({
  depth = 0,
}) => {
  const depthArray = Array.from({ length: depth + 1 }, (_, index) => index)
  return (
    <div className='ml-2.5 mr-2.5 flex space-x-[12px]'>
      {depthArray.map(d => (
        <div key={d} className='h-6 w-px bg-divider-regular'></div>
      ))}
    </div>
  )
}
export default React.memo(TreeIndentLine)
