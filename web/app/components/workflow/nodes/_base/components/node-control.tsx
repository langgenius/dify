import type { FC } from 'react'
import type { Node } from '../../../types'
import { cn } from '@langgenius/dify-ui/cn'
import { memo } from 'react'
import { useHooksStore } from '@/app/components/workflow/hooks-store'
import { NodeActionsDropdown } from '@/app/components/workflow/node-actions-menu'
import { useWorkflowStore } from '@/app/components/workflow/store'
import { useNodesInteractions } from '../../../hooks/use-nodes-interactions'
import { useSingleRunAuthorization } from '../../../hooks/use-single-run-authorization'
import { useNodesReadOnly } from '../../../hooks/use-workflow'
import { NodeRunningStatus } from '../../../types'
import { canRunBySingle } from '../../../utils'
import SingleRunButton from './single-run-button'

type NodeControlProps = Pick<Node, 'id' | 'data'> & {
  pluginInstallLocked?: boolean
}
const NodeControl: FC<NodeControlProps> = ({ id, data, pluginInstallLocked }) => {
  const { handleNodeSelect } = useNodesInteractions()
  const { nodesReadOnly } = useNodesReadOnly()
  const workflowStore = useWorkflowStore()
  const canRun = useHooksStore((s) => s.accessControl.canRun)
  const isSingleRunning = data._singleRunningStatus === NodeRunningStatus.Running
  const { disabledReason } = useSingleRunAuthorization(id, data)

  const isChildNode = !!(data.isInIteration || data.isInLoop)
  return (
    <div
      className={cn(
        'pointer-events-none absolute -top-8 right-0 flex h-8 origin-bottom-right pb-1 opacity-0',
        'focus-within:pointer-events-auto focus-within:opacity-100',
        !pluginInstallLocked && 'group-hover:pointer-events-auto group-hover:opacity-100',
        data.selected && 'pointer-events-auto opacity-100',
        'has-data-popup-open:pointer-events-auto has-data-popup-open:opacity-100',
      )}
      style={{ scale: 'var(--workflow-control-scale, 1)' }}
    >
      <div
        className="nodrag nopan nowheel flex h-7 items-center rounded-lg border-[0.5px] border-components-actionbar-border bg-components-actionbar-bg px-0.5 text-text-tertiary shadow-md backdrop-blur-[5px]"
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
      >
        {canRun && !nodesReadOnly && canRunBySingle(data.type, isChildNode) && (
          <SingleRunButton
            running={isSingleRunning}
            disabledReason={disabledReason}
            compact
            onClick={() => {
              const action = isSingleRunning ? 'stop' : 'run'

              const store = workflowStore.getState()
              store.setInitShowLastRunTab(true)
              store.setPendingSingleRun({
                nodeId: id,
                action,
              })
              handleNodeSelect(id)
            }}
          />
        )}
        <NodeActionsDropdown id={id} data={data} />
      </div>
    </div>
  )
}

export default memo(NodeControl)
