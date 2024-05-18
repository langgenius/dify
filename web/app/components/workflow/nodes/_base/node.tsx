import type {
  FC,
  ReactElement,
} from 'react'
import {
  cloneElement,
  memo,
  useMemo,
  useRef,
} from 'react'
import type { NodeProps } from '../../types'
import {
  BlockEnum,
  NodeRunningStatus,
} from '../../types'
import {
  useNodesReadOnly,
  useToolIcon,
} from '../../hooks'
import {
  NodeSourceHandle,
  NodeTargetHandle,
} from './components/node-handle'
import NodeControl from './components/node-control'
import BlockIcon from '@/app/components/workflow/block-icon'
import {
  CheckCircle,
  Loading02,
} from '@/app/components/base/icons/src/vender/line/general'
import { AlertCircle } from '@/app/components/base/icons/src/vender/line/alertsAndFeedback'

type BaseNodeProps = {
  children: ReactElement
} & NodeProps

const BaseNode: FC<BaseNodeProps> = ({
  id,
  data,
  children,
}) => {
  const nodeRef = useRef<HTMLDivElement>(null)
  const { nodesReadOnly } = useNodesReadOnly()
  const toolIcon = useToolIcon(data)

  const showSelectedBorder = data.selected || data._isBundled
  const {
    showRunningBorder,
    showSuccessBorder,
    showFailedBorder,
  } = useMemo(() => {
    return {
      showRunningBorder: data._runningStatus === NodeRunningStatus.Running && !showSelectedBorder,
      showSuccessBorder: data._runningStatus === NodeRunningStatus.Succeeded && !showSelectedBorder,
      showFailedBorder: data._runningStatus === NodeRunningStatus.Failed && !showSelectedBorder,
    }
  }, [data._runningStatus, showSelectedBorder])

  return (
    <div
      className={`
        flex border-[2px] rounded-2xl
        ${(showSelectedBorder && !data._isInvalidConnection) ? 'border-primary-600' : 'border-transparent'}
      `}
      ref={nodeRef}
    >
      <div
        className={`
          group relative pb-1 w-[240px] bg-[#fcfdff] shadow-xs
          border border-transparent rounded-[15px]
          ${!data._runningStatus && 'hover:shadow-lg'}
          ${showRunningBorder && '!border-primary-500'}
          ${showSuccessBorder && '!border-[#12B76A]'}
          ${showFailedBorder && '!border-[#F04438]'}
          ${data._isInvalidConnection && '!border-[#F04438]'}
          ${data._isBundled && '!shadow-lg'}
        `}
      >
        {
          data.type !== BlockEnum.VariableAssigner && !data._isCandidate && (
            <NodeTargetHandle
              id={id}
              data={data}
              handleClassName='!top-4 !-left-[9px] !translate-y-0'
              handleId='target'
            />
          )
        }
        {
          data.type !== BlockEnum.IfElse && data.type !== BlockEnum.QuestionClassifier && !data._isCandidate && (
            <NodeSourceHandle
              id={id}
              data={data}
              handleClassName='!top-4 !-right-[9px] !translate-y-0'
              handleId='source'
            />
          )
        }
        {
          !data._runningStatus && !nodesReadOnly && !data._isCandidate && (
            <NodeControl
              id={id}
              data={data}
            />
          )
        }
        <div className='flex items-center px-3 pt-3 pb-2'>
          <BlockIcon
            className='shrink-0 mr-2'
            type={data.type}
            size='md'
            toolIcon={toolIcon}
          />
          <div
            title={data.title}
            className='grow mr-1 text-[13px] font-semibold text-gray-700 truncate'
          >
            {data.title}
          </div>
          {
            (data._runningStatus === NodeRunningStatus.Running || data._singleRunningStatus === NodeRunningStatus.Running) && (
              <Loading02 className='w-3.5 h-3.5 text-primary-600 animate-spin' />
            )
          }
          {
            data._runningStatus === NodeRunningStatus.Succeeded && (
              <CheckCircle className='w-3.5 h-3.5 text-[#12B76A]' />
            )
          }
          {
            data._runningStatus === NodeRunningStatus.Failed && (
              <AlertCircle className='w-3.5 h-3.5 text-[#F04438]' />
            )
          }
        </div>
        {cloneElement(children, { id, data })}
        {
          data.desc && (
            <div className='px-3 pt-1 pb-2 text-xs leading-[18px] text-gray-500 whitespace-pre-line break-words'>
              {data.desc}
            </div>
          )
        }
      </div>
    </div>
  )
}

export default memo(BaseNode)
