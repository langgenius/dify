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
        'flex rounded-2xl border-[2px]',
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
          'rounded-[15px] border border-transparent',
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
            <div className='top system-2xs-medium-uppercase absolute -top-2.5 left-2 z-10 text-text-tertiary'>
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
          'flex items-center rounded-t-2xl px-3 pb-2 pt-3',
        )}>
          <BlockIcon
            className='mr-2 shrink-0'
            type={data.type}
            size='md'
          />
          <div
            title={data.title}
            className='system-sm-semibold-uppercase mr-1 flex grow items-center truncate text-text-primary'
          >
            <div>
              {data.title}
            </div>
          </div>
          {
            (data._runningStatus === NodeRunningStatus.Running || data._singleRunningStatus === NodeRunningStatus.Running) && (
              <RiLoader2Line className='h-3.5 w-3.5 animate-spin text-text-accent' />
            )
          }
          {
            data._runningStatus === NodeRunningStatus.Succeeded && (
              <RiCheckboxCircleFill className='h-3.5 w-3.5 text-text-success' />
            )
          }
          {
            data._runningStatus === NodeRunningStatus.Failed && (
              <RiErrorWarningFill className='h-3.5 w-3.5 text-text-destructive' />
            )
          }
          {
            data._runningStatus === NodeRunningStatus.Exception && (
              <RiAlertFill className='h-3.5 w-3.5 text-text-warning-secondary' />
            )
          }
        </div>
      </div>
    </div>
  )
}

export default memo(SimpleNode)
