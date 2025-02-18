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
  useNodeDataUpdate,
  useNodesInteractions,
  useNodesSyncDraft,
} from '../../../hooks'
import type { Node } from '../../../types'
import { canRunBySingle } from '../../../utils'
import PanelOperator from './panel-operator'
import {
  Stop,
} from '@/app/components/base/icons/src/vender/line/mediaAndDevices'
import Tooltip from '@/app/components/base/tooltip'

type NodeControlProps = Pick<Node, 'id' | 'data'>
const NodeControl: FC<NodeControlProps> = ({
  id,
  data,
}) => {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const { handleNodeDataUpdate } = useNodeDataUpdate()
  const { handleNodeSelect } = useNodesInteractions()
  const { handleSyncWorkflowDraft } = useNodesSyncDraft()

  const handleOpenChange = useCallback((newOpen: boolean) => {
    setOpen(newOpen)
  }, [])

  return (
    <div
      className={`
      absolute -top-7 right-0 hidden h-7 pb-1 group-hover:flex
      ${data.selected && '!flex'}
      ${open && '!flex'}
      `}
    >
      <div
        className='bg-components-actionbar-bg border-components-actionbar-border text-text-tertiary flex h-6 items-center rounded-lg border-[0.5px] px-0.5 shadow-md backdrop-blur-[5px]'
        onClick={e => e.stopPropagation()}
      >
        {
          canRunBySingle(data.type) && (
            <div
              className='hover:bg-state-base-hover flex h-5 w-5 cursor-pointer items-center justify-center rounded-md'
              onClick={() => {
                handleNodeDataUpdate({
                  id,
                  data: {
                    _isSingleRun: !data._isSingleRun,
                  },
                })
                handleNodeSelect(id)
                if (!data._isSingleRun)
                  handleSyncWorkflowDraft(true)
              }}
            >
              {
                data._isSingleRun
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
