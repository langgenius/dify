import type { FC } from 'react'
import React from 'react'
import type { ToolNodeType } from './types'
import type { NodeProps } from '@/app/components/workflow/types'

const Node: FC<NodeProps<ToolNodeType>> = ({
  data,
}) => {
  const { tool_configurations } = data

  return (
    <div className='px-3'>
      <div className='space-y-0.5'>
        {Object.keys(tool_configurations || {}).map((key, index) => (
          <div key={index} className='flex items-center h-6 justify-between bg-gray-100 rounded-md  px-1 space-x-1 text-xs font-normal text-gray-700'>
            <div className='text-xs font-medium text-gray-500 uppercase'>
              {key}
            </div>
            <div className='text-xs font-normal text-gray-700'>
              {tool_configurations[key]}
            </div>
          </div>

        ))}

      </div>
    </div>
  )
}

export default React.memo(Node)
