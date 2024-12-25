import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import {
  RiAlertFill,
  RiCheckboxCircleFill,
  RiLoader2Line,
} from '@remixicon/react'
import type { Node } from '@/app/components/workflow/types'
import { NodeRunningStatus } from '@/app/components/workflow/types'
import cn from '@/utils/classnames'

type RetryOnNodeProps = Pick<Node, 'id' | 'data'>
const RetryOnNode = ({
  data,
}: RetryOnNodeProps) => {
  const { t } = useTranslation()
  const { retry_config } = data
  const showSelectedBorder = data.selected || data._isBundled || data._isEntering
  const {
    isRunning,
    isSuccessful,
    isException,
    isFailed,
  } = useMemo(() => {
    return {
      isRunning: data._runningStatus === NodeRunningStatus.Running && !showSelectedBorder,
      isSuccessful: data._runningStatus === NodeRunningStatus.Succeeded && !showSelectedBorder,
      isFailed: data._runningStatus === NodeRunningStatus.Failed && !showSelectedBorder,
      isException: data._runningStatus === NodeRunningStatus.Exception && !showSelectedBorder,
    }
  }, [data._runningStatus, showSelectedBorder])
  const showDefault = !isRunning && !isSuccessful && !isException && !isFailed

  if (!retry_config?.retry_enabled)
    return null

  if (!showDefault && !data._retryIndex)
    return null

  return (
    <div className='px-3'>
      <div className={cn(
        'flex items-center justify-between px-[5px] py-1 bg-workflow-block-parma-bg border-[0.5px] border-transparent rounded-md system-xs-medium-uppercase text-text-tertiary',
        isRunning && 'bg-state-accent-hover border-state-accent-active text-text-accent',
        isSuccessful && 'bg-state-success-hover border-state-success-active text-text-success',
        (isException || isFailed) && 'bg-state-warning-hover border-state-warning-active text-text-warning',
      )}>
        <div className='flex items-center'>
          {
            showDefault && (
              t('workflow.nodes.common.retry.retryTimes', { times: retry_config.max_retries })
            )
          }
          {
            isRunning && (
              <>
                <RiLoader2Line className='animate-spin mr-1 w-3.5 h-3.5' />
                {t('workflow.nodes.common.retry.retrying')}
              </>
            )
          }
          {
            isSuccessful && (
              <>
                <RiCheckboxCircleFill className='mr-1 w-3.5 h-3.5' />
                {t('workflow.nodes.common.retry.retrySuccessful')}
              </>
            )
          }
          {
            (isFailed || isException) && (
              <>
                <RiAlertFill className='mr-1 w-3.5 h-3.5' />
                {t('workflow.nodes.common.retry.retryFailed')}
              </>
            )
          }
        </div>
        {
          !showDefault && !!data._retryIndex && (
            <div>
              {data._retryIndex}/{data.retry_config?.max_retries}
            </div>
          )
        }
      </div>
    </div>
  )
}

export default RetryOnNode
