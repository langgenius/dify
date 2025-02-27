'use client'
import type { FC } from 'react'
import { Theme } from '@/types/app'
import cn from '@/utils/classnames'
import useTheme from '@/hooks/use-theme'

type Props = {
  status: string
  children?: React.ReactNode
}

const StatusContainer: FC<Props> = ({
  status,
  children,
}) => {
  const { theme } = useTheme()
  return (
    <div
      className={cn(
        'relative px-3 py-2.5 rounded-lg border system-xs-regular break-all',
        status === 'succeeded' && 'border-[rgba(23,178,106,0.8)] bg-workflow-display-success-bg bg-[url(~@/app/components/workflow/run/assets/bg-line-success.svg)] text-text-success',
        status === 'succeeded' && theme === Theme.light && 'shadow-[inset_2px_2px_0_0_rgba(255,255,255,0.5),inset_0_1px_3px_0_rgba(0,0,0,0.12),inset_0_2px_24px_0_rgba(23,178,106,0.2),0_1px_2px_0_rgba(9,9,11,0.05),0_0_0_1px_rgba(0,0,0,0.05)]',
        status === 'succeeded' && theme === Theme.dark && 'shadow-[inset_2px_2px_0_0_rgba(255,255,255,0.12),inset_0_1px_3px_0_rgba(0,0,0,0.4),inset_0_2px_24px_0_rgba(23,178,106,0.25),0_1px_2px_0_rgba(0,0,0,0.1),0_0_0_1px_rgba(24, 24, 27, 0.95)]',
        status === 'partial-succeeded' && 'border-[rgba(23,178,106,0.8)] bg-workflow-display-success-bg bg-[url(~@/app/components/workflow/run/assets/bg-line-success.svg)] text-text-success',
        status === 'partial-succeeded' && theme === Theme.light && 'shadow-[inset_2px_2px_0_0_rgba(255,255,255,0.5),inset_0_1px_3px_0_rgba(0,0,0,0.12),inset_0_2px_24px_0_rgba(23,178,106,0.2),0_1px_2px_0_rgba(9,9,11,0.05),0_0_0_1px_rgba(0,0,0,0.05)]',
        status === 'partial-succeeded' && theme === Theme.dark && 'shadow-[inset_2px_2px_0_0_rgba(255,255,255,0.12),inset_0_1px_3px_0_rgba(0,0,0,0.4),inset_0_2px_24px_0_rgba(23,178,106,0.25),0_1px_2px_0_rgba(0,0,0,0.1),0_0_0_1px_rgba(24, 24, 27, 0.95)]',
        status === 'failed' && 'border-[rgba(240,68,56,0.8)] bg-workflow-display-error-bg bg-[url(~@/app/components/workflow/run/assets/bg-line-error.svg)] text-text-warning',
        status === 'failed' && theme === Theme.light && 'shadow-[inset_2px_2px_0_0_rgba(255,255,255,0.5),inset_0_1px_3px_0_rgba(0,0,0,0.12),inset_0_2px_24px_0_rgba(240,68,56,0.2),0_1px_2px_0_rgba(9,9,11,0.05),0_0_0_1px_rgba(0,0,0,0.05)]',
        status === 'failed' && theme === Theme.dark && 'shadow-[inset_2px_2px_0_0_rgba(255,255,255,0.12),inset_0_1px_3px_0_rgba(0,0,0,0.4),inset_0_2px_24px_0_rgba(240,68,56,0.25),0_1px_2px_0_rgba(0,0,0,0.1),0_0_0_1px_rgba(24, 24, 27, 0.95)]',
        status === 'stopped' && 'border-[rgba(247,144,9,0.8)] bg-workflow-display-warning-bg bg-[url(~@/app/components/workflow/run/assets/bg-line-warning.svg)] text-text-destructive',
        status === 'stopped' && theme === Theme.light && 'shadow-[inset_2px_2px_0_0_rgba(255,255,255,0.5),inset_0_1px_3px_0_rgba(0,0,0,0.12),inset_0_2px_24px_0_rgba(247,144,9,0.2),0_1px_2px_0_rgba(9,9,11,0.05),0_0_0_1px_rgba(0,0,0,0.05)]',
        status === 'stopped' && theme === Theme.dark && 'shadow-[inset_2px_2px_0_0_rgba(255,255,255,0.12),inset_0_1px_3px_0_rgba(0,0,0,0.4),inset_0_2px_24px_0_rgba(247,144,9,0.25),0_1px_2px_0_rgba(0,0,0,0.1),0_0_0_1px_rgba(24, 24, 27, 0.95)]',
        status === 'exception' && 'border-[rgba(247,144,9,0.8)] bg-workflow-display-warning-bg bg-[url(~@/app/components/workflow/run/assets/bg-line-warning.svg)] text-text-destructive',
        status === 'exception' && theme === Theme.light && 'shadow-[inset_2px_2px_0_0_rgba(255,255,255,0.5),inset_0_1px_3px_0_rgba(0,0,0,0.12),inset_0_2px_24px_0_rgba(247,144,9,0.2),0_1px_2px_0_rgba(9,9,11,0.05),0_0_0_1px_rgba(0,0,0,0.05)]',
        status === 'exception' && theme === Theme.dark && 'shadow-[inset_2px_2px_0_0_rgba(255,255,255,0.12),inset_0_1px_3px_0_rgba(0,0,0,0.4),inset_0_2px_24px_0_rgba(247,144,9,0.25),0_1px_2px_0_rgba(0,0,0,0.1),0_0_0_1px_rgba(24, 24, 27, 0.95)]',
        status === 'running' && 'border-[rgba(11,165,236,0.8)] bg-workflow-display-normal-bg bg-[url(~@/app/components/workflow/run/assets/bg-line-running.svg)] text-util-colors-blue-light-blue-light-600',
        status === 'running' && theme === Theme.light && 'shadow-[inset_2px_2px_0_0_rgba(255,255,255,0.5),inset_0_1px_3px_0_rgba(0,0,0,0.12),inset_0_2px_24px_0_rgba(11,165,236,0.2),0_1px_2px_0_rgba(9,9,11,0.05),0_0_0_1px_rgba(0,0,0,0.05)]',
        status === 'running' && theme === Theme.dark && 'shadow-[inset_2px_2px_0_0_rgba(255,255,255,0.12),inset_0_1px_3px_0_rgba(0,0,0,0.4),inset_0_2px_24px_0_rgba(11,165,236,0.25),0_1px_2px_0_rgba(0,0,0,0.1),0_0_0_1px_rgba(24, 24, 27, 0.95)]',
      )}
    >
      <div className={cn(
        'absolute top-0 left-0 w-[65%] h-[50px] bg-no-repeat',
        theme === Theme.light && 'bg-[url(~@/app/components/workflow/run/assets/highlight.svg)]',
        theme === Theme.dark && 'bg-[url(~@/app/components/workflow/run/assets/highlight-dark.svg)]',
      )}></div>
      {children}
    </div>
  )
}

export default StatusContainer
