import type { FC } from 'react'
import React from 'react'
import type { HttpNodeType } from './types'
import type { NodeProps } from '@/app/components/workflow/types'
import SupportVarInput from '@/app/components/workflow/nodes/_base/components/support-var-input'

const Node: FC<NodeProps<HttpNodeType>> = ({
  data,
}) => {
  const { method, url } = data
  return (
    <div className='mb-1 px-3 py-1'>
      <div className='flex items-center p-1 rounded-md bg-gray-100'>
        <div className='shrink-0 px-1 h-7 leading-7 rounded bg-gray-25 text-xs font-semibold text-gray-700 uppercase'>{method}</div>
        <SupportVarInput
          wrapClassName='w-0 grow truncate flex items-center'
          textClassName='ml-1 text-xs font-normal text-gray-700'
          value={url}
          readonly
        />
      </div>
    </div>
  )
}

export default React.memo(Node)
