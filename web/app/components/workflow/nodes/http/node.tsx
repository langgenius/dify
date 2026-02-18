import type { FC } from 'react'
import type { HttpNodeType } from './types'
import type { NodeProps } from '@/app/components/workflow/types'
import * as React from 'react'
import ReadonlyInputWithSelectVar from '../_base/components/readonly-input-with-select-var'

const Node: FC<NodeProps<HttpNodeType>> = ({
  id,
  data,
}) => {
  const { method, url } = data
  if (!url)
    return null

  return (
    <div className="mb-1 px-3 py-1">
      <div className="flex items-center justify-start rounded-md bg-workflow-block-parma-bg p-1">
        <div className="flex h-4 shrink-0 items-center rounded bg-components-badge-white-to-dark px-1 text-xs font-semibold uppercase text-text-secondary">{method}</div>
        <div className="w-0 grow pl-1 pt-1">
          <ReadonlyInputWithSelectVar
            className="text-text-secondary"
            value={url}
            nodeId={id}
          />
        </div>
      </div>
    </div>
  )
}

export default React.memo(Node)
