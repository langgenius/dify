import type {
  FC,
  ReactNode,
} from 'react'
import {
  cloneElement,
  memo,
  useEffect,
  useMemo,
  useRef,
} from 'react'
import {
  RiAlertFill,
  RiCheckboxCircleFill,
  RiErrorWarningFill,
  RiLoader2Line,
} from '@remixicon/react'
import { useTranslation } from 'react-i18next'
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
  hasErrorHandleNode,
  hasRetryNode,
} from '../../utils'
import { useNodeIterationInteractions } from '../iteration/use-interactions'
import type { IterationNodeType } from '../iteration/types'
import {
  NodeSourceHandle,
  NodeTargetHandle,
} from './components/node-handle'
import NodeResizer from './components/node-resizer'
import NodeControl from './components/node-control'
import ErrorHandleOnNode from './components/error-handle/error-handle-on-node'
import RetryOnNode from './components/retry/retry-on-node'
import AddVariablePopupWithPosition from './components/add-variable-popup-with-position'
import cn from '@/utils/classnames'
import BlockIcon from '@/app/components/workflow/block-icon'
import Tooltip from '@/app/components/base/tooltip'

type BaseNodeProps = {
  children: ReactNode
} & NodeProps

const BaseNode: FC<BaseNodeProps> = ({
  id,
  data,
  children,
}) => {
  const { t } = useTranslation()
  const nodeRef = useRef<HTMLDivElement>(null)
  const { nodesReadOnly } = useNodesReadOnly()
  const { handleNodeIterationChildSizeChange } = useNodeIterationInteractions()
  const toolIcon = useToolIcon(data)

  useEffect(() => {
    if (nodeRef.current && data.selected && data.isInIteration) {
      const resizeObserver = new ResizeObserver(() => {
        handleNodeIterationChildSizeChange(id)
      })

      resizeObserver.observe(nodeRef.current)

      return () => {
        resizeObserver.disconnect()
      }
    }
  }, [data.isInIteration, data.selected, id, handleNodeIterationChildSizeChange])

  const showSelectedBorder = data.selected || data._isBundled || data._isEntering
  const {
    showRunningBorder,
    showSuccessBorder,
    showFailedBorder,
    showExceptionBorder,
  } = useMemo(() => {
    return {
      showRunningBorder: data._runningStatus === NodeRunningStatus.Running && !showSelectedBorder,
      showSuccessBorder: data._runningStatus === NodeRunningStatus.Succeeded && !showSelectedBorder,
      showFailedBorder: data._runningStatus === NodeRunningStatus.Failed && !showSelectedBorder,
      showExceptionBorder: data._runningStatus === NodeRunningStatus.Exception && !showSelectedBorder,
    }
  }, [data._runningStatus, showSelectedBorder])

  return (
    <div
      className={cn(
        'flex rounded-2xl border-[2px]',
        showSelectedBorder ? 'border-components-option-card-option-selected-border' : 'border-transparent',
        !showSelectedBorder && data._inParallelHovering && 'border-workflow-block-border-highlight',
        data._waitingRun && 'opacity-70',
      )}
      ref={nodeRef}
      style={{
        width: data.type === BlockEnum.Iteration ? data.width : 'auto',
        height: data.type === BlockEnum.Iteration ? data.height : 'auto',
      }}
    >
      <div
        className={cn(
          'shadow-xs group relative pb-1',
          'rounded-[15px] border border-transparent',
          data.type !== BlockEnum.Iteration && 'bg-workflow-block-bg w-[240px]',
          data.type === BlockEnum.Iteration && 'bg-workflow-block-bg-transparent border-workflow-block-border flex h-full w-full flex-col',
          !data._runningStatus && 'hover:shadow-lg',
          showRunningBorder && '!border-state-accent-solid',
          showSuccessBorder && '!border-state-success-solid',
          showFailedBorder && '!border-state-destructive-solid',
          showExceptionBorder && '!border-state-warning-solid',
          data._isBundled && '!shadow-lg',
        )}
      >
        {
          data._inParallelHovering && (
            <div className='top system-2xs-medium-uppercase text-text-tertiary absolute -top-2.5 left-2 z-10'>
              {t('workflow.common.parallelRun')}
            </div>
          )
        }
        {
          data._showAddVariablePopup && (
            <AddVariablePopupWithPosition
              nodeId={id}
              nodeData={data}
            />
          )
        }
        {
          data.type === BlockEnum.Iteration && (
            <NodeResizer
              nodeId={id}
              nodeData={data}
            />
          )
        }
        {
          !data._isCandidate && (
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
        <div className={cn(
          'flex items-center rounded-t-2xl px-3 pb-2 pt-3',
          data.type === BlockEnum.Iteration && 'bg-transparent',
        )}>
          <BlockIcon
            className='mr-2 shrink-0'
            type={data.type}
            size='md'
            toolIcon={toolIcon}
          />
          <div
            title={data.title}
            className='system-sm-semibold-uppercase text-text-primary mr-1 flex grow items-center truncate'
          >
            <div>
              {data.title}
            </div>
            {
              data.type === BlockEnum.Iteration && (data as IterationNodeType).is_parallel && (
                <Tooltip popupContent={
                  <div className='w-[180px]'>
                    <div className='font-extrabold'>
                      {t('workflow.nodes.iteration.parallelModeEnableTitle')}
                    </div>
                    {t('workflow.nodes.iteration.parallelModeEnableDesc')}
                  </div>}
                >
                  <div className='border-text-warning text-text-warning system-2xs-medium-uppercase ml-1 flex items-center justify-center rounded-[5px] border-[1px] px-[5px] py-[3px] '>
                    {t('workflow.nodes.iteration.parallelModeUpper')}
                  </div>
                </Tooltip>
              )
            }
          </div>
          {
            data._iterationLength && data._iterationIndex && data._runningStatus === NodeRunningStatus.Running && (
              <div className='text-text-accent mr-1.5 text-xs font-medium'>
                {data._iterationIndex > data._iterationLength ? data._iterationLength : data._iterationIndex}/{data._iterationLength}
              </div>
            )
          }
          {
            (data._runningStatus === NodeRunningStatus.Running || data._singleRunningStatus === NodeRunningStatus.Running) && (
              <RiLoader2Line className='text-text-accent h-3.5 w-3.5 animate-spin' />
            )
          }
          {
            data._runningStatus === NodeRunningStatus.Succeeded && (
              <RiCheckboxCircleFill className='text-text-success h-3.5 w-3.5' />
            )
          }
          {
            data._runningStatus === NodeRunningStatus.Failed && (
              <RiErrorWarningFill className='text-text-destructive h-3.5 w-3.5' />
            )
          }
          {
            data._runningStatus === NodeRunningStatus.Exception && (
              <RiAlertFill className='text-text-warning-secondary h-3.5 w-3.5' />
            )
          }
        </div>
        {
          data.type !== BlockEnum.Iteration && (
            cloneElement(children, { id, data })
          )
        }
        {
          data.type === BlockEnum.Iteration && (
            <div className='grow pb-1 pl-1 pr-1'>
              {cloneElement(children, { id, data })}
            </div>
          )
        }
        {
          hasRetryNode(data.type) && (
            <RetryOnNode
              id={id}
              data={data}
            />
          )
        }
        {
          hasErrorHandleNode(data.type) && (
            <ErrorHandleOnNode
              id={id}
              data={data}
            />
          )
        }
        {
          data.desc && data.type !== BlockEnum.Iteration && (
            <div className='system-xs-regular text-text-tertiary whitespace-pre-line break-words px-3 pb-2 pt-1'>
              {data.desc}
            </div>
          )
        }
      </div>
    </div>
  )
}

export default memo(BaseNode)
