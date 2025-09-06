import type { FC } from 'react'
import React from 'react'
import type { PluginTriggerNodeType } from './types'
import type { NodeProps } from '@/app/components/workflow/types'

const Node: FC<NodeProps<PluginTriggerNodeType>> = ({
  data,
}) => {
  const { config = {} } = data
  const configKeys = Object.keys(config)

  if (!data.tool_name && configKeys.length === 0)
    return null

  return (
    <div className="mb-1 px-3 py-1">
      {data.tool_name && (
        <div className="mb-1 text-xs font-medium text-gray-700">
          {data.tool_name}
          {data.event_type && (
            <div className="text-xs text-gray-500">
              {data.event_type}
            </div>
          )}
        </div>
      )}

      {configKeys.length > 0 && (
        <div className="space-y-0.5">
          {configKeys.map((key, index) => (
            <div
              key={index}
              className="flex h-6 items-center justify-between space-x-1 rounded-md bg-workflow-block-parma-bg px-1 text-xs font-normal text-text-secondary"
            >
              <div
                title={key}
                className="max-w-[100px] shrink-0 truncate text-xs font-medium uppercase text-text-tertiary"
              >
                {key}
              </div>
              <div
                title={String(config[key] || '')}
                className="w-0 shrink-0 grow truncate text-right text-xs font-normal text-text-secondary"
              >
                {typeof config[key] === 'string' && config[key].includes('secret')
                  ? '********'
                  : String(config[key] || '')}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default React.memo(Node)
