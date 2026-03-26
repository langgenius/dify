import type { ReactNode } from 'react'
import type { InspectHeaderProps } from './types'
import { useMemo, useState } from 'react'
import ActionButton from '@/app/components/base/action-button'
import { cn } from '@/utils/classnames'
import { useStore } from '../store'
import useInspectShell, { InspectShellContext } from './hooks/use-inspect-shell'
import TabHeader from './tab-header'

type InspectShellProps = InspectHeaderProps & {
  children: ReactNode
  left?: ReactNode
}

function SinglePaneCloseButton() {
  const { onClose } = useInspectShell()

  return (
    <div className="flex min-w-0 flex-1 justify-end pr-2 pt-2">
      <ActionButton onClick={onClose} aria-label="Close">
        <span className="i-ri-close-line h-4 w-4" aria-hidden="true" />
      </ActionButton>
    </div>
  )
}

export default function InspectShell({
  activeTab,
  onTabChange,
  onClose,
  headerActions,
  left,
  children,
}: InspectShellProps) {
  const bottomPanelWidth = useStore(s => s.bottomPanelWidth)
  const isNarrow = bottomPanelWidth < 488
  const [showLeftPane, setShowLeftPane] = useState(true)
  const hasLeftPane = !!left

  const contextValue = useMemo(() => ({
    closeLeftPane: () => setShowLeftPane(false),
    isNarrow: hasLeftPane
      ? isNarrow
      : false,
    onClose,
    openLeftPane: () => setShowLeftPane(true),
  }), [hasLeftPane, isNarrow, onClose])

  return (
    <InspectShellContext value={contextValue}>
      {hasLeftPane
        ? (
            <div className="flex h-full">
              <div className="relative flex w-60 shrink-0 flex-col border-r border-divider-burn">
                <div className="flex shrink-0 items-center">
                  <TabHeader activeTab={activeTab} onTabChange={onTabChange}>
                    {headerActions}
                  </TabHeader>
                </div>
                {isNarrow && showLeftPane && (
                  <div
                    role="presentation"
                    className="absolute left-0 top-0 h-full w-full"
                    onClick={() => setShowLeftPane(false)}
                  />
                )}
                <div
                  className={cn(
                    'min-h-0 flex-1',
                    isNarrow
                      ? showLeftPane
                        ? 'absolute left-0 top-0 z-10 h-full w-[217px] rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg shadow-lg backdrop-blur-sm'
                        : 'hidden'
                      : '',
                  )}
                >
                  {left}
                </div>
              </div>
              <div className="flex min-w-0 flex-1 flex-col">
                {children}
              </div>
            </div>
          )
        : (
            <div className="flex h-full flex-col">
              <div className="flex shrink-0 items-center">
                <div className="flex w-60 shrink-0 items-center">
                  <TabHeader activeTab={activeTab} onTabChange={onTabChange}>
                    {headerActions}
                  </TabHeader>
                </div>
                <SinglePaneCloseButton />
              </div>
              <div className="flex min-h-0 flex-1 flex-col">
                {children}
              </div>
            </div>
          )}
    </InspectShellContext>
  )
}
