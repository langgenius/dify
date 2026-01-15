import type { FC } from 'react'
import type { WebhookTriggerNodeType } from './types'
import type { NodeProps } from '@/app/components/workflow/types'
import * as React from 'react'

const Node: FC<NodeProps<WebhookTriggerNodeType>> = ({
  data,
}) => {
  return (
    <div className="mb-1 px-3 py-1">
      <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-text-tertiary">
        URL
      </div>
      <div className="flex h-[26px] items-center rounded-md bg-workflow-block-parma-bg px-2 text-xs text-text-secondary">
        <div className="w-0 grow">
          <div className="truncate" title={data.webhook_url || '--'}>
            {data.webhook_url || '--'}
          </div>
        </div>
      </div>
    </div>
  )
}

export default React.memo(Node)
