import type { NodeProps } from 'reactflow'
import type { HumanInputNodeType } from '@/app/components/workflow/nodes/human-input/types'
import { memo } from 'react'
import { NodeSourceHandle } from '../../node-handle'

function HumanInputNode(props: NodeProps<HumanInputNodeType>) {
  const { data } = props

  return (
    <div className="space-y-0.5 px-3 py-1">
      {data.user_actions.map((userAction) => (
        <div key={userAction.id} className="relative flex h-6 flex-row-reverse items-center px-1">
          <span className="truncate system-xs-semibold-uppercase text-text-secondary">
            {userAction.id}
          </span>
          <NodeSourceHandle
            {...props}
            handleId={userAction.id}
            handleClassName="top-1/2! -right-[21px]! -translate-y-1/2!"
          />
        </div>
      ))}
      <div className="relative flex h-6 flex-row-reverse items-center px-1">
        <span className="truncate system-xs-semibold-uppercase text-text-secondary">Timeout</span>
        <NodeSourceHandle
          {...props}
          handleId="__timeout"
          handleClassName="top-1/2! -right-[21px]! -translate-y-1/2!"
        />
      </div>
    </div>
  )
}

export default memo(HumanInputNode)
