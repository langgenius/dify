import type { FC } from 'react'
import React from 'react'
import ReadonlyInputWithSelectVar from '../_base/components/readonly-input-with-select-var'
import type { HttpNodeType } from './types'
import type { NodeProps } from '@/app/components/workflow/types'
const Node: FC<NodeProps<HttpNodeType>> = ({
  id,
  data,
}) => {
  const { method, url } = data
  if (!url)
    return null

  return (
    <div className='mb-1 px-3 py-1'>
      <div className='flex items-start p-1 rounded-md bg-gray-100'>
        <div className='flex items-center h-4 shrink-0 px-1 rounded bg-gray-25 text-xs font-semibold text-gray-700 uppercase'>{method}</div>
        <div className='pl-1 pt-1'>
          <ReadonlyInputWithSelectVar
            value={url}
            nodeId={id}
          />
        </div>
      </div>
    </div>
  )
}

export default React.memo(Node)
