import type { FC } from 'react'
import React from 'react'
import type { ToolNodeType } from './types'
import { VarType } from './types'
import { Variable02 } from '@/app/components/base/icons/src/vender/solid/development'
import type { NodeProps } from '@/app/components/workflow/types'

const Node: FC<NodeProps<ToolNodeType>> = ({
  data,
}) => {
  const { tool_parameters: tool_inputs } = data

  return (
    <div className='px-3'>
      <div className='space-y-0.5'>
        {tool_inputs.map((input, index) => (
          <div key={index} className='flex items-center h-6 justify-between bg-gray-100 rounded-md  px-1 space-x-1 text-xs font-normal text-gray-700'>
            <div className='text-xs font-medium text-gray-500 uppercase'>
              {input.variable}
            </div>
            <div className='text-xs font-normal text-gray-700'>
              {input.variable_type === VarType.selector
                ? (
                  <div className='flex items-center text-primary-600 space-x-0.5'>
                    <Variable02 className='h-3.5 w-3.5' />
                    <div className='font-medium'>{input.value_selector?.slice(0, -1)[0]}</div>
                  </div>
                )
                : input.value}
            </div>
          </div>

        ))}

      </div>
    </div>
  )
}

export default React.memo(Node)
