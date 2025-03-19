import type {
  FC,
} from 'react'
import {
  memo,
  useMemo,
} from 'react'
import {
  RiAlertFill,
  RiCheckboxCircleFill,
  RiErrorWarningFill,
  RiLoader2Line,
} from '@remixicon/react'
import { useTranslation } from 'react-i18next'
import {
  NodeTargetHandle,
} from '@/app/components/workflow/nodes/_base/components/node-handle'
import NodeControl from '@/app/components/workflow/nodes/_base/components/node-control'
import cn from '@/utils/classnames'
import BlockIcon from '@/app/components/workflow/block-icon'
import type {
  NodeProps,
} from '@/app/components/workflow/types'
import {
  NodeRunningStatus,
} from '@/app/components/workflow/types'
import {
  useNodesReadOnly,
} from '@/app/components/workflow/hooks'

type SimpleNodeProps = NodeProps

const SimpleNode: FC<SimpleNodeProps> = ({
  id,
  data,
}) => {
  const { t } = useTranslation()
  const { nodesReadOnly } = useNodesReadOnly()

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
        'flex border-[2px] rounded-2xl',
        showSelectedBorder ? 'border-components-option-card-option-selected-border' : 'border-transparent',
        !showSelectedBorder && data._inParallelHovering && 'border-workflow-block-border-highlight',
        data._waitingRun && 'opacity-70',
      )}
      style={{
        width: 'auto',
        height: 'auto',
      }}
    >
      <div
        className={cn(
          'group relative pb-1 shadow-xs',
          'border border-transparent rounded-[15px]',
          'w-[240px] bg-workflow-block-bg',
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
            <div className='absolute left-2 -top-2.5 top system-2xs-medium-uppercase text-text-tertiary z-10'>
              {t('workflow.common.parallelRun')}
            </div>
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
          !data._runningStatus && !nodesReadOnly && !data._isCandidate && (
            <NodeControl
              id={id}
              data={data}
            />
          )
        }
        <div className={cn(
          'flex items-center px-3 pt-3 pb-2 rounded-t-2xl',
        )}>
          <BlockIcon
            className='shrink-0 mr-2'
            type={data.type}
            size='md'
          />
          <div
            title={data.title}
            className='grow mr-1 system-sm-semibold-uppercase text-text-primary truncate flex items-center'
          >
            <div>
              {data.title}
            </div>
          </div>
          {
            (data._runningStatus === NodeRunningStatus.Running || data._singleRunningStatus === NodeRunningStatus.Running) && (
              <RiLoader2Line className='w-3.5 h-3.5 text-text-accent animate-spin' />
            )
          }
          {
            data._runningStatus === NodeRunningStatus.Succeeded && (
              <RiCheckboxCircleFill className='w-3.5 h-3.5 text-text-success' />
            )
          }
          {
            data._runningStatus === NodeRunningStatus.Failed && (
              <RiErrorWarningFill className='w-3.5 h-3.5 text-text-destructive' />
            )
          }
          {
            data._runningStatus === NodeRunningStatus.Exception && (
              <RiAlertFill className='w-3.5 h-3.5 text-text-warning-secondary' />
            )
          }
        </div>
      </div>
    </div>
  )
}

export default memo(SimpleNode)
