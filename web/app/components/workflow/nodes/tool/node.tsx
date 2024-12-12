import type { FC } from 'react'
import React from 'react'
import type { ToolNodeType } from './types'
import type { NodeProps } from '@/app/components/workflow/types'
import { FormTypeEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'

const Node: FC<NodeProps<ToolNodeType>> = ({
  data,
}) => {
  const { tool_configurations } = data
  const toolConfigs = Object.keys(tool_configurations || {})

  if (!toolConfigs.length)
    return null

  return (
    <div className='mb-1 px-3 py-1'>
      <div className='space-y-0.5'>
        {toolConfigs.map((key, index) => (
          <div key={index} className='flex items-center h-6 justify-between bg-gray-100 rounded-md  px-1 space-x-1 text-xs font-normal text-gray-700'>
            <div title={key} className='max-w-[100px] shrink-0 truncate text-xs font-medium text-gray-500 uppercase'>
              {key}
            </div>
            {typeof tool_configurations[key] === 'string' && (
              <div title={tool_configurations[key]} className='grow w-0 shrink-0 truncate text-right text-xs font-normal text-gray-700'>
                {tool_configurations[key]}
              </div>
            )}
            {typeof tool_configurations[key] !== 'string' && tool_configurations[key]?.type === FormTypeEnum.modelSelector && (
              <div title={tool_configurations[key].model} className='grow w-0 shrink-0 truncate text-right text-xs font-normal text-gray-700'>
                {tool_configurations[key].model}
              </div>
            )}
            {/* {typeof tool_configurations[key] !== 'string' && tool_configurations[key]?.type === FormTypeEnum.appSelector && (
              <div title={tool_configurations[key].app_id} className='grow w-0 shrink-0 truncate text-right text-xs font-normal text-gray-700'>
                {tool_configurations[key].app_id}
              </div>
            )} */}
          </div>

        ))}

      </div>
    </div>
  )
}

export default React.memo(Node)
