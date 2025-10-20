import type { FC } from 'react'
import {
  memo,
  useCallback,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import {
  RiPlayLargeLine,
} from '@remixicon/react'
import {
  useNodesInteractions,
} from '../../../hooks'
import { type Node, NodeRunningStatus } from '../../../types'
import { canRunBySingle } from '../../../utils'
import PanelOperator from './panel-operator'
import {
  Stop,
} from '@/app/components/base/icons/src/vender/line/mediaAndDevices'
import Tooltip from '@/app/components/base/tooltip'
import { useWorkflowStore } from '@/app/components/workflow/store'

type NodeControlProps = Pick<Node, 'id' | 'data'>
const NodeControl: FC<NodeControlProps> = ({
  id,
  data,
}) => {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const { handleNodeSelect } = useNodesInteractions()
  const workflowStore = useWorkflowStore()
  const isSingleRunning = data._singleRunningStatus === NodeRunningStatus.Running
  const handleOpenChange = useCallback((newOpen: boolean) => {
    setOpen(newOpen)
  }, [])

  const isChildNode = !!(data.isInIteration || data.isInLoop)
  return (
    <div
      className={`
      absolute -top-7 right-0 hidden h-7 pb-1 group-hover:flex
      ${data.selected && '!flex'}
      ${open && '!flex'}
      `}
    >
      <div
        className='flex h-6 items-center rounded-lg border-[0.5px] border-components-actionbar-border bg-components-actionbar-bg px-0.5 text-text-tertiary shadow-md backdrop-blur-[5px]'
        onClick={e => e.stopPropagation()}
      >
        {
          canRunBySingle(data.type, isChildNode) && (
            <div
              className='flex h-5 w-5 cursor-pointer items-center justify-center rounded-md hover:bg-state-base-hover'
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
                  ? <Stop className='h-3 w-3' />
                  : (
                    <Tooltip
                      popupContent={t('workflow.panel.runThisStep')}
                      asChild={false}
                    >
                      <RiPlayLargeLine className='h-3 w-3' />
                    </Tooltip>
                  )
              }
            </div>
          )
        }
        <PanelOperator
          id={id}
          data={data}
          offset={0}
          onOpenChange={handleOpenChange}
          triggerClassName='!w-5 !h-5'
        />
      </div>
    </div>
  )
}

export default memo(NodeControl)
