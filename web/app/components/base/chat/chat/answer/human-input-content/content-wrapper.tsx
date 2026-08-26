import { cn } from '@langgenius/dify-ui/cn'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import BlockIcon from '@/app/components/workflow/block-icon'
import { BlockEnum } from '@/app/components/workflow/types'

type ContentWrapperProps = {
  nodeTitle: string
  children: React.ReactNode
  showExpandIcon?: boolean
  className?: string
  expanded?: boolean
}

const ContentWrapper = ({
  nodeTitle,
  children,
  showExpandIcon = false,
  className,
  expanded = false,
}: ContentWrapperProps) => {
  const { t } = useTranslation()
  const [isExpanded, setIsExpanded] = useState(expanded)

  const handleToggleExpand = useCallback(() => {
    setIsExpanded(!isExpanded)
  }, [isExpanded])

  return (
    <div
      className={cn(
        'rounded-2xl border-[0.5px] border-components-panel-border bg-background-section p-2 shadow-md',
        className,
      )}
      data-testid="content-wrapper"
    >
      <div className="flex items-center gap-2 p-2">
        {/* node icon */}
        <BlockIcon type={BlockEnum.HumanInput} className="shrink-0" />
        {/* node name */}
        <div
          className="grow truncate system-sm-semibold-uppercase text-text-primary"
          title={nodeTitle}
        >
          {nodeTitle}
        </div>
        {showExpandIcon && (
          <button
            type="button"
            aria-expanded={isExpanded}
            aria-label={`${
              isExpanded
                ? t(($) => $['chat.collapse'], { ns: 'share' })
                : t(($) => $['chat.expand'], { ns: 'share' })
            } ${nodeTitle}`}
            className="flex size-4 shrink-0 cursor-pointer appearance-none items-center justify-center focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden"
            onClick={handleToggleExpand}
          >
            {isExpanded ? (
              <span aria-hidden className="i-ri-arrow-down-s-line size-4" />
            ) : (
              <span aria-hidden className="i-ri-arrow-right-s-line size-4" />
            )}
          </button>
        )}
      </div>
      {(!showExpandIcon || isExpanded) && (
        <div className="px-2 py-1">
          {/* human input form content */}
          {children}
        </div>
      )}
    </div>
  )
}

export default ContentWrapper
