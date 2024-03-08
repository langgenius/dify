import type { FC } from 'react'
import {
  memo,
  useCallback,
  useState,
} from 'react'
import { useWorkflow } from '../../../hooks'
import type { Node } from '../../../types'
import { canRunBySingle } from '../../../utils'
import PanelOperator from './panel-operator'
import { Loading02 } from '@/app/components/base/icons/src/vender/line/general'
import {
  Play,
  Stop,
} from '@/app/components/base/icons/src/vender/line/mediaAndDevices'

type NodeControlProps = Pick<Node, 'id' | 'data'>
const NodeControl: FC<NodeControlProps> = ({
  id,
  data,
}) => {
  const [open, setOpen] = useState(false)
  const { handleNodeDataUpdate } = useWorkflow()

  const handleOpenChange = useCallback((newOpen: boolean) => {
    setOpen(newOpen)
  }, [])

  return (
    <div
      className={`
      hidden group-hover:flex pb-1 absolute right-0 -top-7 h-7
      ${data.selected && '!flex'}
      ${open && '!flex'}
      `}
    >
      <div
        className='flex items-center px-0.5 h-6 bg-white rounded-lg border-[0.5px] border-gray-100 shadow-xs text-gray-500'
        onClick={e => e.stopPropagation()}
      >
        {
          data._isSingleRun && (
            <div className='flex items-center mr-1 px-1 h-5 rounded-md bg-primary-50 text-xs font-medium text-primary-600'>
              <Loading02 className='mr-1 w-3 h-3 animate-spin' />
              RUNNING
            </div>
          )
        }
        {
          canRunBySingle(data.type) && (
            <div
              className='flex items-center justify-center w-5 h-5 rounded-md cursor-pointer hover:bg-black/5'
              onClick={() => {
                handleNodeDataUpdate({
                  id,
                  data: { _isSingleRun: !data._isSingleRun },
                })
              }}
            >
              {
                data._isSingleRun
                  ? <Stop className='w-3 h-3' />
                  : <Play className='w-3 h-3' />
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
