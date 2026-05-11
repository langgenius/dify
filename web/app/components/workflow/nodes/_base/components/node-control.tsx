import type { FC } from 'react'
import type { Node } from '../../../types'
import { cn } from '@langgenius/dify-ui/cn'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@langgenius/dify-ui/tooltip'
import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Stop,
} from '@/app/components/base/icons/src/vender/line/mediaAndDevices'
import { NodeActionsDropdown } from '@/app/components/workflow/node-actions-menu'
import { useWorkflowStore } from '@/app/components/workflow/store'
import {
  useNodesInteractions,
} from '../../../hooks'
import { NodeRunningStatus } from '../../../types'
import { canRunBySingle } from '../../../utils'

type NodeControlProps = Pick<Node, 'id' | 'data'> & {
  pluginInstallLocked?: boolean
}
const NodeControl: FC<NodeControlProps> = ({
  id,
  data,
  pluginInstallLocked,
}) => {
  const { t } = useTranslation()
  const { handleNodeSelect } = useNodesInteractions()
  const workflowStore = useWorkflowStore()
  const isSingleRunning = data._singleRunningStatus === NodeRunningStatus.Running

  const isChildNode = !!(data.isInIteration || data.isInLoop)
  return (
    <div
      className={cn(
        'invisible absolute -top-7 right-0 flex h-7 pb-1',
        !pluginInstallLocked && 'group-hover:visible',
        data.selected && 'visible',
        'has-[[data-popup-open]]:visible',
      )}
    >
      <div
        className="nodrag nopan nowheel flex h-6 items-center rounded-lg border-[0.5px] border-components-actionbar-border bg-components-actionbar-bg px-0.5 text-text-tertiary shadow-md backdrop-blur-[5px]"
        onMouseDown={e => e.stopPropagation()}
        onClick={e => e.stopPropagation()}
      >
        {
          canRunBySingle(data.type, isChildNode) && (
            <button
              type="button"
              aria-label={isSingleRunning ? t('debug.variableInspect.trigger.stop', { ns: 'workflow' }) : t('panel.runThisStep', { ns: 'workflow' })}
              className={`flex h-5 w-5 items-center justify-center rounded-md ${isSingleRunning && 'cursor-pointer hover:bg-state-base-hover'}`}
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
            >
              {
                isSingleRunning
                  ? <Stop className="h-3 w-3" />
                  : (
                      <Tooltip>
                        <TooltipTrigger
                          render={<span className="i-ri-play-large-line h-3 w-3" />}
                        />
                        <TooltipContent>
                          {t('panel.runThisStep', { ns: 'workflow' })}
                        </TooltipContent>
                      </Tooltip>
                    )
              }
            </button>
          )
        }
        <NodeActionsDropdown
          id={id}
          data={data}
          triggerClassName="w-5! h-5!"
        />
      </div>
    </div>
  )
}

export default memo(NodeControl)
