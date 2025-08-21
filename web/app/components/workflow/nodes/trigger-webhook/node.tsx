import type { FC } from 'react'
import React from 'react'
import type { WebhookTriggerNodeType } from './types'
import type { NodeProps } from '@/app/components/workflow/types'

const Node: FC<NodeProps<WebhookTriggerNodeType>> = ({
  data,
}) => {
  return (
    <div className="mb-1 px-3 py-1">
      <div className="mb-1 text-xs text-text-secondary">
        URL
      </div>
      {data.webhook_url && (
        <div
          className="max-w-[200px] cursor-default truncate rounded bg-components-badge-bg-gray-soft px-2 py-1 text-xs text-text-tertiary"
          title={data.webhook_url}
        >
          <span className="truncate" title={data.webhook_url}>
            {data.webhook_url}
          </span>
        </div>
      )}
    </div>
  )
}

export default React.memo(Node)
