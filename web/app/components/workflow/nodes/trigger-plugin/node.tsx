import type { FC } from 'react'
import React from 'react'
import type { PluginTriggerNodeType } from './types'
import type { NodeProps } from '@/app/components/workflow/types'

const Node: FC<NodeProps<PluginTriggerNodeType>> = ({
  data,
}) => {
  return (
    <div className="mb-1 px-3 py-1">
      {data.plugin_name ? (
        <>
          <div className="text-xs font-medium text-gray-700">
            {data.plugin_name}
          </div>
          {data.event_type && (
            <div className="text-xs text-gray-500">
              {data.event_type}
            </div>
          )}
        </>
      ) : (
        <div className="text-xs text-gray-500">
          Plugin not configured
        </div>
      )}
    </div>
  )
}

export default React.memo(Node)
