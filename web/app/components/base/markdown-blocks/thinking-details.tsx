import type { ComponentProps } from 'react'
import { cn } from '@langgenius/dify-ui/cn'
import { useTranslation } from 'react-i18next'

type ThinkingDetailsProps = ComponentProps<'details'> & {
  isComplete: boolean
  elapsedTime?: number
}

/**
 * Presentational collapsible "thinking" shell: the chevron summary with the
 * "Thinking…/Thought (Xs)" label and the bordered content body. Driver-agnostic
 * — callers compute `isComplete` and only pass `elapsedTime` when it was observed.
 */
const ThinkingDetails = ({
  isComplete,
  elapsedTime,
  className,
  open,
  children,
  ...rest
}: ThinkingDetailsProps) => {
  const { t } = useTranslation()
  const status = t(($) => (isComplete ? $['chat.thought'] : $['chat.thinking']), { ns: 'common' })

  return (
    <details {...rest} className={cn('group', className)} open={isComplete ? open : true}>
      <summary className="flex cursor-pointer list-none items-center pl-2 font-bold whitespace-nowrap text-text-secondary select-none">
        <div className="flex shrink-0 items-center">
          <svg
            className="mr-2 size-3 transition-transform duration-500 group-open:rotate-90"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
          {status}
          {elapsedTime !== undefined && <span aria-hidden>({elapsedTime.toFixed(1)}s)</span>}
        </div>
      </summary>
      <div className="ml-2 border-l border-components-panel-border bg-components-panel-bg-alt p-3 text-text-secondary">
        {children}
      </div>
    </details>
  )
}

export default ThinkingDetails
