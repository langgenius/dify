'use client'
import type { FC } from 'react'
import { useAppContext } from '@/context/app-context'
import { Theme } from '@/types/app'
import cn from '@/utils/classnames'

type Props = {
  status: string
  children?: React.ReactNode
}

const StatusContainer: FC<Props> = ({
  status,
  children,
}) => {
  const { theme } = useAppContext()
  return (
    <div
      className={cn(
        'system-xs-regular relative break-all rounded-lg border px-3 py-2.5',
        status === 'succeeded' && 'bg-workflow-display-success-bg text-text-success border-[rgba(23,178,106,0.8)] bg-[url(~@/app/components/workflow/run/assets/bg-line-success.svg)]',
        status === 'succeeded' && theme === Theme.light && 'shadow-[inset_2px_2px_0_0_rgba(255,255,255,0.5),inset_0_1px_3px_0_rgba(0,0,0,0.12),inset_0_2px_24px_0_rgba(23,178,106,0.2),0_1px_2px_0_rgba(9,9,11,0.05),0_0_0_1px_rgba(0,0,0,0.05)]',
        status === 'succeeded' && theme === Theme.dark && 'shadow-[inset_2px_2px_0_0_rgba(255,255,255,0.12),inset_0_1px_3px_0_rgba(0,0,0,0.4),inset_0_2px_24px_0_rgba(23,178,106,0.25),0_1px_2px_0_rgba(0,0,0,0.1),0_0_0_1px_rgba(24, 24, 27, 0.95)]',
        status === 'partial-succeeded' && 'bg-workflow-display-success-bg text-text-success border-[rgba(23,178,106,0.8)] bg-[url(~@/app/components/workflow/run/assets/bg-line-success.svg)]',
        status === 'partial-succeeded' && theme === Theme.light && 'shadow-[inset_2px_2px_0_0_rgba(255,255,255,0.5),inset_0_1px_3px_0_rgba(0,0,0,0.12),inset_0_2px_24px_0_rgba(23,178,106,0.2),0_1px_2px_0_rgba(9,9,11,0.05),0_0_0_1px_rgba(0,0,0,0.05)]',
        status === 'partial-succeeded' && theme === Theme.dark && 'shadow-[inset_2px_2px_0_0_rgba(255,255,255,0.12),inset_0_1px_3px_0_rgba(0,0,0,0.4),inset_0_2px_24px_0_rgba(23,178,106,0.25),0_1px_2px_0_rgba(0,0,0,0.1),0_0_0_1px_rgba(24, 24, 27, 0.95)]',
        status === 'failed' && 'bg-workflow-display-error-bg text-text-warning border-[rgba(240,68,56,0.8)] bg-[url(~@/app/components/workflow/run/assets/bg-line-error.svg)]',
        status === 'failed' && theme === Theme.light && 'shadow-[inset_2px_2px_0_0_rgba(255,255,255,0.5),inset_0_1px_3px_0_rgba(0,0,0,0.12),inset_0_2px_24px_0_rgba(240,68,56,0.2),0_1px_2px_0_rgba(9,9,11,0.05),0_0_0_1px_rgba(0,0,0,0.05)]',
        status === 'failed' && theme === Theme.dark && 'shadow-[inset_2px_2px_0_0_rgba(255,255,255,0.12),inset_0_1px_3px_0_rgba(0,0,0,0.4),inset_0_2px_24px_0_rgba(240,68,56,0.25),0_1px_2px_0_rgba(0,0,0,0.1),0_0_0_1px_rgba(24, 24, 27, 0.95)]',
        status === 'stopped' && 'bg-workflow-display-warning-bg text-text-destructive border-[rgba(247,144,9,0.8)] bg-[url(~@/app/components/workflow/run/assets/bg-line-warning.svg)]',
        status === 'stopped' && theme === Theme.light && 'shadow-[inset_2px_2px_0_0_rgba(255,255,255,0.5),inset_0_1px_3px_0_rgba(0,0,0,0.12),inset_0_2px_24px_0_rgba(247,144,9,0.2),0_1px_2px_0_rgba(9,9,11,0.05),0_0_0_1px_rgba(0,0,0,0.05)]',
        status === 'stopped' && theme === Theme.dark && 'shadow-[inset_2px_2px_0_0_rgba(255,255,255,0.12),inset_0_1px_3px_0_rgba(0,0,0,0.4),inset_0_2px_24px_0_rgba(247,144,9,0.25),0_1px_2px_0_rgba(0,0,0,0.1),0_0_0_1px_rgba(24, 24, 27, 0.95)]',
        status === 'exception' && 'bg-workflow-display-warning-bg text-text-destructive border-[rgba(247,144,9,0.8)] bg-[url(~@/app/components/workflow/run/assets/bg-line-warning.svg)]',
        status === 'exception' && theme === Theme.light && 'shadow-[inset_2px_2px_0_0_rgba(255,255,255,0.5),inset_0_1px_3px_0_rgba(0,0,0,0.12),inset_0_2px_24px_0_rgba(247,144,9,0.2),0_1px_2px_0_rgba(9,9,11,0.05),0_0_0_1px_rgba(0,0,0,0.05)]',
        status === 'exception' && theme === Theme.dark && 'shadow-[inset_2px_2px_0_0_rgba(255,255,255,0.12),inset_0_1px_3px_0_rgba(0,0,0,0.4),inset_0_2px_24px_0_rgba(247,144,9,0.25),0_1px_2px_0_rgba(0,0,0,0.1),0_0_0_1px_rgba(24, 24, 27, 0.95)]',
        status === 'running' && 'bg-workflow-display-normal-bg text-util-colors-blue-light-blue-light-600 border-[rgba(11,165,236,0.8)] bg-[url(~@/app/components/workflow/run/assets/bg-line-running.svg)]',
        status === 'running' && theme === Theme.light && 'shadow-[inset_2px_2px_0_0_rgba(255,255,255,0.5),inset_0_1px_3px_0_rgba(0,0,0,0.12),inset_0_2px_24px_0_rgba(11,165,236,0.2),0_1px_2px_0_rgba(9,9,11,0.05),0_0_0_1px_rgba(0,0,0,0.05)]',
        status === 'running' && theme === Theme.dark && 'shadow-[inset_2px_2px_0_0_rgba(255,255,255,0.12),inset_0_1px_3px_0_rgba(0,0,0,0.4),inset_0_2px_24px_0_rgba(11,165,236,0.25),0_1px_2px_0_rgba(0,0,0,0.1),0_0_0_1px_rgba(24, 24, 27, 0.95)]',
      )}
    >
      <div className={cn(
        'absolute left-0 top-0 h-[50px] w-[65%] bg-no-repeat',
        theme === Theme.light && 'bg-[url(~@/app/components/workflow/run/assets/highlight.svg)]',
        theme === Theme.dark && 'bg-[url(~@/app/components/workflow/run/assets/highlight-dark.svg)]',
      )}></div>
      {children}
    </div>
  )
}

export default StatusContainer
