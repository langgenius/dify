import type { FC } from 'react'
import React from 'react'
import type { HttpNodeType } from './types'
import type { NodeProps } from '@/app/components/workflow/types'

const Node: FC<NodeProps<HttpNodeType>> = ({
  data,
}) => {
  const { method, url } = data
  return (
    <div className='px-3'>
      <div className='flex items-center p-1 rounded-md bg-gray-100'>
        <div className='shrink-0 px-1 h-7 leading-7 rounded bg-gray-25 text-xs font-semibold text-gray-700 uppercase'>{method}</div>
        <div className='ml-1 w-0 grow truncate text-xs font-normal text-gray-700'>{url}</div>
      </div>
    </div>
  )
}

export default React.memo(Node)
