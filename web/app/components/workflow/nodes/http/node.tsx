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
      <div className='flex items-start rounded-md bg-gray-100 p-1'>
        <div className='bg-gray-25 flex h-4 shrink-0 items-center rounded px-1 text-xs font-semibold uppercase text-gray-700'>{method}</div>
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
