import { useCallback, useState } from 'react'
import BlockIcon from '@/app/components/workflow/block-icon'
import { BlockEnum } from '@/app/components/workflow/types'
import { cn } from '@/utils/classnames'

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
  const [isExpanded, setIsExpanded] = useState(expanded)

  const handleToggleExpand = useCallback(() => {
    setIsExpanded(!isExpanded)
  }, [isExpanded])

  return (
    <div
      className={cn('rounded-2xl border-[0.5px] border-components-panel-border bg-background-section p-2 shadow-md', className)}
      data-testid="content-wrapper"
    >
      <div className="flex items-center gap-2 p-2">
        {/* node icon */}
        <BlockIcon type={BlockEnum.HumanInput} className="shrink-0" />
        {/* node name */}
        <div
          className="grow truncate text-text-primary system-sm-semibold-uppercase"
          title={nodeTitle}
        >
          {nodeTitle}
        </div>
        {showExpandIcon && (
          <div
            className="shrink-0 cursor-pointer"
            onClick={handleToggleExpand}
            data-testid="expand-icon"
          >
            {
              isExpanded
                ? (
                    <div className="i-ri-arrow-down-s-line size-4" />
                  )
                : (
                    <div className="i-ri-arrow-right-s-line size-4" />
                  )
            }
          </div>
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
