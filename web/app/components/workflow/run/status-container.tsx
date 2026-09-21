'use client'
import type { CSSProperties, FC } from 'react'
import { cn } from '@langgenius/dify-ui/cn'
import { CopyFeedback } from '@/app/components/base/copy-feedback'
import useTheme from '@/hooks/use-theme'
import { Theme } from '@/types/app'
import bgLineErrorUrl from './assets/bg-line-error.svg'
import bgLineRunningUrl from './assets/bg-line-running.svg'
import bgLineSuccessUrl from './assets/bg-line-success.svg'
import bgLineWarningUrl from './assets/bg-line-warning.svg'
import highlightDarkUrl from './assets/highlight-dark.svg'
import highlightUrl from './assets/highlight.svg'

type Props = {
  readonly status: string
  readonly children?: React.ReactNode
  readonly copyContent?: string
}

// Bundlers hand static assets back either as a URL string or as an object
// carrying one, so normalize before building the `url()` value.
const assetUrl = (asset: { src: string } | string) =>
  typeof asset === 'string' ? asset : asset.src

const backgroundImage = (asset: { src: string } | string): CSSProperties => ({
  backgroundImage: `url(${assetUrl(asset)})`,
})

const STATUS_BACKGROUNDS: Record<string, { src: string } | string> = {
  succeeded: bgLineSuccessUrl,
  'partial-succeeded': bgLineSuccessUrl,
  failed: bgLineErrorUrl,
  stopped: bgLineWarningUrl,
  paused: bgLineWarningUrl,
  exception: bgLineWarningUrl,
  running: bgLineRunningUrl,
}

const StatusContainer: FC<Props> = ({ status, children, copyContent }) => {
  const { theme } = useTheme()
  const isCopyable = copyContent !== undefined
  const statusBackground = STATUS_BACKGROUNDS[status]
  // Theme is briefly undefined before next-themes resolves it; match the
  // previous behaviour of painting no highlight until it is known.
  const highlightAsset =
    theme === Theme.dark ? highlightDarkUrl : theme === Theme.light ? highlightUrl : undefined

  return (
    <div
      role="status"
      style={statusBackground ? backgroundImage(statusBackground) : undefined}
      className={cn(
        'group/status relative rounded-lg border border-workflow-display-disabled-border-1 px-3 py-2.5 system-xs-regular break-all',
        isCopyable && 'focus-within:pr-10 hover:pr-10 [@media(hover:none)]:pr-10',
        status === 'succeeded' &&
          'border-[rgba(23,178,106,0.8)] bg-workflow-display-success-bg text-text-success',
        status === 'succeeded' &&
          theme === Theme.light &&
          'shadow-[inset_2px_2px_0_0_rgba(255,255,255,0.5),inset_0_1px_3px_0_rgba(0,0,0,0.12),inset_0_2px_24px_0_rgba(23,178,106,0.2),0_1px_2px_0_rgba(9,9,11,0.05),0_0_0_1px_rgba(0,0,0,0.05)]',
        status === 'succeeded' &&
          theme === Theme.dark &&
          'shadow-[inset_2px_2px_0_0_rgba(255,255,255,0.12),inset_0_1px_3px_0_rgba(0,0,0,0.4),inset_0_2px_24px_0_rgba(23,178,106,0.25),0_1px_2px_0_rgba(0,0,0,0.1),0_0_0_1px_rgba(24,24,27,0.95)]',
        status === 'partial-succeeded' &&
          'border-[rgba(23,178,106,0.8)] bg-workflow-display-success-bg text-text-success',
        status === 'partial-succeeded' &&
          theme === Theme.light &&
          'shadow-[inset_2px_2px_0_0_rgba(255,255,255,0.5),inset_0_1px_3px_0_rgba(0,0,0,0.12),inset_0_2px_24px_0_rgba(23,178,106,0.2),0_1px_2px_0_rgba(9,9,11,0.05),0_0_0_1px_rgba(0,0,0,0.05)]',
        status === 'partial-succeeded' &&
          theme === Theme.dark &&
          'shadow-[inset_2px_2px_0_0_rgba(255,255,255,0.12),inset_0_1px_3px_0_rgba(0,0,0,0.4),inset_0_2px_24px_0_rgba(23,178,106,0.25),0_1px_2px_0_rgba(0,0,0,0.1),0_0_0_1px_rgba(24,24,27,0.95)]',
        status === 'failed' &&
          'border-[rgba(240,68,56,0.8)] bg-workflow-display-error-bg text-text-warning',
        status === 'failed' &&
          theme === Theme.light &&
          'shadow-[inset_2px_2px_0_0_rgba(255,255,255,0.5),inset_0_1px_3px_0_rgba(0,0,0,0.12),inset_0_2px_24px_0_rgba(240,68,56,0.2),0_1px_2px_0_rgba(9,9,11,0.05),0_0_0_1px_rgba(0,0,0,0.05)]',
        status === 'failed' &&
          theme === Theme.dark &&
          'shadow-[inset_2px_2px_0_0_rgba(255,255,255,0.12),inset_0_1px_3px_0_rgba(0,0,0,0.4),inset_0_2px_24px_0_rgba(240,68,56,0.25),0_1px_2px_0_rgba(0,0,0,0.1),0_0_0_1px_rgba(24,24,27,0.95)]',
        (status === 'stopped' || status === 'paused') &&
          'border-[rgba(247,144,9,0.8)] bg-workflow-display-warning-bg text-text-destructive',
        (status === 'stopped' || status === 'paused') &&
          theme === Theme.light &&
          'shadow-[inset_2px_2px_0_0_rgba(255,255,255,0.5),inset_0_1px_3px_0_rgba(0,0,0,0.12),inset_0_2px_24px_0_rgba(247,144,9,0.2),0_1px_2px_0_rgba(9,9,11,0.05),0_0_0_1px_rgba(0,0,0,0.05)]',
        (status === 'stopped' || status === 'paused') &&
          theme === Theme.dark &&
          'shadow-[inset_2px_2px_0_0_rgba(255,255,255,0.12),inset_0_1px_3px_0_rgba(0,0,0,0.4),inset_0_2px_24px_0_rgba(247,144,9,0.25),0_1px_2px_0_rgba(0,0,0,0.1),0_0_0_1px_rgba(24,24,27,0.95)]',
        status === 'exception' &&
          'border-[rgba(247,144,9,0.8)] bg-workflow-display-warning-bg text-text-destructive',
        status === 'exception' &&
          theme === Theme.light &&
          'shadow-[inset_2px_2px_0_0_rgba(255,255,255,0.5),inset_0_1px_3px_0_rgba(0,0,0,0.12),inset_0_2px_24px_0_rgba(247,144,9,0.2),0_1px_2px_0_rgba(9,9,11,0.05),0_0_0_1px_rgba(0,0,0,0.05)]',
        status === 'exception' &&
          theme === Theme.dark &&
          'shadow-[inset_2px_2px_0_0_rgba(255,255,255,0.12),inset_0_1px_3px_0_rgba(0,0,0,0.4),inset_0_2px_24px_0_rgba(247,144,9,0.25),0_1px_2px_0_rgba(0,0,0,0.1),0_0_0_1px_rgba(24,24,27,0.95)]',
        status === 'running' &&
          'border-[rgba(11,165,236,0.8)] bg-workflow-display-normal-bg text-util-colors-blue-light-blue-light-600',
        status === 'running' &&
          theme === Theme.light &&
          'shadow-[inset_2px_2px_0_0_rgba(255,255,255,0.5),inset_0_1px_3px_0_rgba(0,0,0,0.12),inset_0_2px_24px_0_rgba(11,165,236,0.2),0_1px_2px_0_rgba(9,9,11,0.05),0_0_0_1px_rgba(0,0,0,0.05)]',
        status === 'running' &&
          theme === Theme.dark &&
          'shadow-[inset_2px_2px_0_0_rgba(255,255,255,0.12),inset_0_1px_3px_0_rgba(0,0,0,0.4),inset_0_2px_24px_0_rgba(11,165,236,0.25),0_1px_2px_0_rgba(0,0,0,0.1),0_0_0_1px_rgba(24,24,27,0.95)]',
      )}
    >
      <div
        style={highlightAsset ? backgroundImage(highlightAsset) : undefined}
        className="pointer-events-none absolute top-0 left-0 h-12.5 w-[65%] bg-no-repeat"
      ></div>
      {children}
      {isCopyable && (
        <div className="pointer-events-none absolute top-1.5 right-1.5 z-10 opacity-0 transition-opacity group-focus-within/status:pointer-events-auto group-focus-within/status:opacity-100 group-hover/status:pointer-events-auto group-hover/status:opacity-100 [@media(hover:none)]:pointer-events-auto [@media(hover:none)]:opacity-100">
          <CopyFeedback content={copyContent} />
        </div>
      )}
    </div>
  )
}

export default StatusContainer
