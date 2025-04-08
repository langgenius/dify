import type { FC } from 'react'
import React from 'react'
import type { ToolNodeType } from './types'
import type { NodeProps } from '@/app/components/workflow/types'
import { FormTypeEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'

const Node: FC<NodeProps<ToolNodeType>> = ({
  data,
}) => {
  const { tool_configurations, paramSchemas } = data
  const toolConfigs = Object.keys(tool_configurations || {})

  if (!toolConfigs.length)
    return null

  return (
    <div className='mb-1 px-3 py-1'>
      <div className='space-y-0.5'>
        {toolConfigs.map((key, index) => (
          <div key={index} className='flex h-6 items-center justify-between space-x-1 rounded-md  bg-gray-100 px-1 text-xs font-normal text-gray-700'>
            <div title={key} className='max-w-[100px] shrink-0 truncate text-xs font-medium uppercase text-gray-500'>
              {key}
            </div>
            {typeof tool_configurations[key] === 'string' && (
              <div title={tool_configurations[key]} className='w-0 shrink-0 grow truncate text-right text-xs font-normal text-gray-700'>
                {paramSchemas?.find(i => i.name === key)?.type === FormTypeEnum.secretInput ? '********' : tool_configurations[key]}
              </div>
            )}
            {typeof tool_configurations[key] === 'number' && (
              <div title={tool_configurations[key].toString()} className='w-0 shrink-0 grow truncate text-right text-xs font-normal text-gray-700'>
                {tool_configurations[key]}
              </div>
            )}
            {typeof tool_configurations[key] !== 'string' && tool_configurations[key]?.type === FormTypeEnum.modelSelector && (
              <div title={tool_configurations[key].model} className='w-0 shrink-0 grow truncate text-right text-xs font-normal text-gray-700'>
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
