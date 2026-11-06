'use client'
import type { FC } from 'react'
import { cn } from '@langgenius/dify-ui/cn'
import { CopyFeedback } from '@/app/components/base/copy-feedback'
import { useResolvedTheme } from '@/features/theme/hooks'

type Props = {
  readonly status: string
  readonly children?: React.ReactNode
  readonly copyContent?: string
}

const StatusContainer: FC<Props> = ({ status, children, copyContent }) => {
  const theme = useResolvedTheme()
  const isCopyable = copyContent !== undefined

  return (
    <div
      role="status"
      className={cn(
        'group/status relative rounded-lg border border-workflow-display-disabled-border-1 px-3 py-2.5 system-xs-regular break-all',
        isCopyable && 'focus-within:pe-10 hover:pe-10 [@media(hover:none)]:pe-10',
        status === 'succeeded' &&
          'border-[rgba(23,178,106,0.8)] bg-workflow-display-success-bg bg-[url(~@/app/components/workflow/run/assets/bg-line-success.svg)] text-text-success',
        status === 'succeeded' &&
          theme === 'light' &&
          'shadow-[inset_2px_2px_0_0_rgba(255,255,255,0.5),inset_0_1px_3px_0_rgba(0,0,0,0.12),inset_0_2px_24px_0_rgba(23,178,106,0.2),0_1px_2px_0_rgba(9,9,11,0.05),0_0_0_1px_rgba(0,0,0,0.05)]',
        status === 'succeeded' &&
          theme === 'dark' &&
          'shadow-[inset_2px_2px_0_0_rgba(255,255,255,0.12),inset_0_1px_3px_0_rgba(0,0,0,0.4),inset_0_2px_24px_0_rgba(23,178,106,0.25),0_1px_2px_0_rgba(0,0,0,0.1),0_0_0_1px_rgba(24,24,27,0.95)]',
        status === 'partial-succeeded' &&
          'border-[rgba(23,178,106,0.8)] bg-workflow-display-success-bg bg-[url(~@/app/components/workflow/run/assets/bg-line-success.svg)] text-text-success',
        status === 'partial-succeeded' &&
          theme === 'light' &&
          'shadow-[inset_2px_2px_0_0_rgba(255,255,255,0.5),inset_0_1px_3px_0_rgba(0,0,0,0.12),inset_0_2px_24px_0_rgba(23,178,106,0.2),0_1px_2px_0_rgba(9,9,11,0.05),0_0_0_1px_rgba(0,0,0,0.05)]',
        status === 'partial-succeeded' &&
          theme === 'dark' &&
          'shadow-[inset_2px_2px_0_0_rgba(255,255,255,0.12),inset_0_1px_3px_0_rgba(0,0,0,0.4),inset_0_2px_24px_0_rgba(23,178,106,0.25),0_1px_2px_0_rgba(0,0,0,0.1),0_0_0_1px_rgba(24,24,27,0.95)]',
        status === 'failed' &&
          'border-[rgba(240,68,56,0.8)] bg-workflow-display-error-bg bg-[url(~@/app/components/workflow/run/assets/bg-line-error.svg)] text-text-warning',
        status === 'failed' &&
          theme === 'light' &&
          'shadow-[inset_2px_2px_0_0_rgba(255,255,255,0.5),inset_0_1px_3px_0_rgba(0,0,0,0.12),inset_0_2px_24px_0_rgba(240,68,56,0.2),0_1px_2px_0_rgba(9,9,11,0.05),0_0_0_1px_rgba(0,0,0,0.05)]',
        status === 'failed' &&
          theme === 'dark' &&
          'shadow-[inset_2px_2px_0_0_rgba(255,255,255,0.12),inset_0_1px_3px_0_rgba(0,0,0,0.4),inset_0_2px_24px_0_rgba(240,68,56,0.25),0_1px_2px_0_rgba(0,0,0,0.1),0_0_0_1px_rgba(24,24,27,0.95)]',
        (status === 'stopped' || status === 'paused') &&
          'border-[rgba(247,144,9,0.8)] bg-workflow-display-warning-bg bg-[url(~@/app/components/workflow/run/assets/bg-line-warning.svg)] text-text-destructive',
        (status === 'stopped' || status === 'paused') &&
          theme === 'light' &&
          'shadow-[inset_2px_2px_0_0_rgba(255,255,255,0.5),inset_0_1px_3px_0_rgba(0,0,0,0.12),inset_0_2px_24px_0_rgba(247,144,9,0.2),0_1px_2px_0_rgba(9,9,11,0.05),0_0_0_1px_rgba(0,0,0,0.05)]',
        (status === 'stopped' || status === 'paused') &&
          theme === 'dark' &&
          'shadow-[inset_2px_2px_0_0_rgba(255,255,255,0.12),inset_0_1px_3px_0_rgba(0,0,0,0.4),inset_0_2px_24px_0_rgba(247,144,9,0.25),0_1px_2px_0_rgba(0,0,0,0.1),0_0_0_1px_rgba(24,24,27,0.95)]',
        status === 'exception' &&
          'border-[rgba(247,144,9,0.8)] bg-workflow-display-warning-bg bg-[url(~@/app/components/workflow/run/assets/bg-line-warning.svg)] text-text-destructive',
        status === 'exception' &&
          theme === 'light' &&
          'shadow-[inset_2px_2px_0_0_rgba(255,255,255,0.5),inset_0_1px_3px_0_rgba(0,0,0,0.12),inset_0_2px_24px_0_rgba(247,144,9,0.2),0_1px_2px_0_rgba(9,9,11,0.05),0_0_0_1px_rgba(0,0,0,0.05)]',
        status === 'exception' &&
          theme === 'dark' &&
          'shadow-[inset_2px_2px_0_0_rgba(255,255,255,0.12),inset_0_1px_3px_0_rgba(0,0,0,0.4),inset_0_2px_24px_0_rgba(247,144,9,0.25),0_1px_2px_0_rgba(0,0,0,0.1),0_0_0_1px_rgba(24,24,27,0.95)]',
        status === 'running' &&
          'border-[rgba(11,165,236,0.8)] bg-workflow-display-normal-bg bg-[url(~@/app/components/workflow/run/assets/bg-line-running.svg)] text-util-colors-blue-light-blue-light-600',
        status === 'running' &&
          theme === 'light' &&
          'shadow-[inset_2px_2px_0_0_rgba(255,255,255,0.5),inset_0_1px_3px_0_rgba(0,0,0,0.12),inset_0_2px_24px_0_rgba(11,165,236,0.2),0_1px_2px_0_rgba(9,9,11,0.05),0_0_0_1px_rgba(0,0,0,0.05)]',
        status === 'running' &&
          theme === 'dark' &&
          'shadow-[inset_2px_2px_0_0_rgba(255,255,255,0.12),inset_0_1px_3px_0_rgba(0,0,0,0.4),inset_0_2px_24px_0_rgba(11,165,236,0.25),0_1px_2px_0_rgba(0,0,0,0.1),0_0_0_1px_rgba(24,24,27,0.95)]',
      )}
    >
      <div
        className={cn(
          'pointer-events-none absolute inset-s-0 top-0 h-12.5 w-[65%] bg-no-repeat',
          theme === 'light' && 'bg-[url(~@/app/components/workflow/run/assets/highlight.svg)]',
          theme === 'dark' && 'bg-[url(~@/app/components/workflow/run/assets/highlight-dark.svg)]',
        )}
      ></div>
      {children}
      {isCopyable && (
        <div className="pointer-events-none absolute inset-e-1.5 top-1.5 z-10 opacity-0 transition-opacity group-focus-within/status:pointer-events-auto group-focus-within/status:opacity-100 group-hover/status:pointer-events-auto group-hover/status:opacity-100 [@media(hover:none)]:pointer-events-auto [@media(hover:none)]:opacity-100">
          <CopyFeedback content={copyContent} />
        </div>
      )}
    </div>
  )
}

export default StatusContainer
