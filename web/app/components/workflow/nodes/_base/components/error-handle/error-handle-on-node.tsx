import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useUpdateNodeInternals } from 'reactflow'
import { NodeSourceHandle } from '../node-handle'
import { ErrorHandleTypeEnum } from './types'
import type { Node } from '@/app/components/workflow/types'
import { NodeRunningStatus } from '@/app/components/workflow/types'
import cn from '@/utils/classnames'

type ErrorHandleOnNodeProps = Pick<Node, 'id' | 'data'>
const ErrorHandleOnNode = ({
  id,
  data,
}: ErrorHandleOnNodeProps) => {
  const { t } = useTranslation()
  const { error_strategy } = data
  const updateNodeInternals = useUpdateNodeInternals()

  useEffect(() => {
    if (error_strategy === ErrorHandleTypeEnum.failBranch)
      updateNodeInternals(id)
  }, [error_strategy, id, updateNodeInternals])

  if (!error_strategy)
    return null

  return (
    <div className='relative pt-1 pb-2 px-3'>
      <div className={cn(
        'relative flex items-center justify-between px-[5px] h-6 bg-workflow-block-parma-bg rounded-md',
        data._runningStatus === NodeRunningStatus.Exception && 'border-[0.5px] border-components-badge-status-light-warning-halo bg-state-warning-hover',
      )}>
        <div className='system-xs-medium-uppercase text-text-tertiary'>
          {t('workflow.common.onFailure')}
        </div>
        <div className={cn(
          'system-xs-medium text-text-secondary',
          data._runningStatus === NodeRunningStatus.Exception && 'text-text-warning',
        )}>
          {
            error_strategy === ErrorHandleTypeEnum.defaultValue && (
              t('workflow.nodes.common.errorHandle.defaultValue.output')
            )
          }
          {
            error_strategy === ErrorHandleTypeEnum.failBranch && (
              t('workflow.nodes.common.errorHandle.failBranch.title')
            )
          }
        </div>
        {
          error_strategy === ErrorHandleTypeEnum.failBranch && (
            <NodeSourceHandle
              id={id}
              data={data}
              handleId={ErrorHandleTypeEnum.failBranch}
              handleClassName='!top-1/2 !-right-[21px] !-translate-y-1/2 after:!bg-workflow-link-line-failure-button-bg'
              nodeSelectorClassName='!bg-workflow-link-line-failure-button-bg'
            />
          )
        }
      </div>
    </div>
  )
}

export default ErrorHandleOnNode
