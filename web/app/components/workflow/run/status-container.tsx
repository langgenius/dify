'use client'
import type { FC } from 'react'
import cn from '@/utils/classnames'

type Props = {
  status: string
  children?: React.ReactNode
}

const StatusContainer: FC<Props> = ({
  status,
  children,
}) => {
  return (
    <div
      className={cn(
        'relative px-3 py-2.5 rounded-lg border system-xs-regular break-all',
        status === 'succeeded' && 'border-[rgba(23,178,106,0.8)] bg-workflow-display-success-bg bg-[url(~@/app/components/workflow/run/assets/bg-line-success.svg)] shadow-[inset_2px_2px_0_0_rgba(255,255,255,0.5),inset_0_1px_3px_0_rgba(0,0,0,0.12),inset_0_2px_24px_0_rgba(23,178,106,0.2),0_1px_2px_0_rgba(9,9,11,0.05),0_0_0_1px_rgba(0,0,0,0.05)] text-text-success',
        status === 'partial-succeeded' && 'border-[rgba(23,178,106,0.8)] bg-workflow-display-success-bg bg-[url(~@/app/components/workflow/run/assets/bg-line-success.svg)] shadow-[inset_2px_2px_0_0_rgba(255,255,255,0.5),inset_0_1px_3px_0_rgba(0,0,0,0.12),inset_0_2px_24px_0_rgba(23,178,106,0.2),0_1px_2px_0_rgba(9,9,11,0.05),0_0_0_1px_rgba(0,0,0,0.05)] text-text-success',
        status === 'failed' && 'border-[rgba(240,68,56,0.8)] bg-workflow-display-error-bg bg-[url(~@/app/components/workflow/run/assets/bg-line-error.svg)] shadow-[inset_2px_2px_0_0_rgba(255,255,255,0.5),inset_0_1px_3px_0_rgba(0,0,0,0.12),inset_0_2px_24px_0_rgba(240,68,56,0.2),0_1px_2px_0_rgba(9,9,11,0.05),0_0_0_1px_rgba(0,0,0,0.05)] text-text-warning',
        status === 'stopped' && 'border-[rgba(247,144,9,0.8)] bg-workflow-display-warning-bg bg-[url(~@/app/components/workflow/run/assets/bg-line-warning.svg)] shadow-[inset_2px_2px_0_0_rgba(255,255,255,0.5),inset_0_1px_3px_0_rgba(0,0,0,0.12),inset_0_2px_24px_0_rgba(247,144,9,0.2),0_1px_2px_0_rgba(9,9,11,0.05),0_0_0_1px_rgba(0,0,0,0.05)] text-text-destructive',
        status === 'exception' && 'border-[rgba(247,144,9,0.8)] bg-workflow-display-warning-bg bg-[url(~@/app/components/workflow/run/assets/bg-line-warning.svg)] shadow-[inset_2px_2px_0_0_rgba(255,255,255,0.5),inset_0_1px_3px_0_rgba(0,0,0,0.12),inset_0_2px_24px_0_rgba(247,144,9,0.2),0_1px_2px_0_rgba(9,9,11,0.05),0_0_0_1px_rgba(0,0,0,0.05)] text-text-destructive',
        status === 'running' && 'border-[rgba(11,165,236,0.8)] bg-workflow-display-normal-bg bg-[url(~@/app/components/workflow/run/assets/bg-line-running.svg)] shadow-[inset_2px_2px_0_0_rgba(255,255,255,0.5),inset_0_1px_3px_0_rgba(0,0,0,0.12),inset_0_2px_24px_0_rgba(11,165,236,0.2),0_1px_2px_0_rgba(9,9,11,0.05),0_0_0_1px_rgba(0,0,0,0.05)] text-util-colors-blue-light-blue-light-600',
      )}
    >
      <div className='absolute top-0 left-0 w-[65%] h-[50px] bg-[url(~@/app/components/workflow/run/assets/highlight.svg)]'></div>
      {children}
    </div>
  )
}

export default StatusContainer
