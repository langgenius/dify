import type { FC } from 'react'
import React from 'react'
import type { PluginTriggerNodeType } from './types'
import type { NodeProps } from '@/app/components/workflow/types'
import useConfig from './use-config'

const Node: FC<NodeProps<PluginTriggerNodeType>> = ({
  id,
  data,
}) => {
  const { isAuthenticated } = useConfig(id, data)
  const { config = {} } = data
  const configKeys = Object.keys(config)

  // Only show config when authenticated and has config values
  if (!isAuthenticated || configKeys.length === 0)
    return null

  return (
    <div className="mb-1 px-3 py-1">
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
    </div>
  )
}

export default React.memo(Node)
