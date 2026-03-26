import type { FC, ReactNode } from 'react'
import type { InspectHeaderProps } from './inspect-layout'
import { useState } from 'react'
import { cn } from '@/utils/classnames'
import { useStore } from '../store'
import TabHeader from './tab-header'

export type SplitRightProps = {
  isNarrow: boolean
  onOpenMenu: () => void
  onClose: () => void
}

type SplitPanelProps = InspectHeaderProps & {
  left: ReactNode
  children: (rightProps: SplitRightProps) => ReactNode
}

const SplitPanel: FC<SplitPanelProps> = ({
  activeTab,
  onTabChange,
  onClose,
  headerActions,
  left,
  children,
}) => {
  const bottomPanelWidth = useStore(s => s.bottomPanelWidth)
  const isNarrow = bottomPanelWidth < 488
  const [showLeftPanel, setShowLeftPanel] = useState(true)

  return (
    <div className="flex h-full">
      <div className="relative flex w-60 shrink-0 flex-col border-r border-divider-burn">
        <div className="flex shrink-0 items-center">
          <TabHeader activeTab={activeTab} onTabChange={onTabChange}>
            {headerActions}
          </TabHeader>
        </div>
        {isNarrow && showLeftPanel && (
          <div role="presentation" className="absolute left-0 top-0 h-full w-full" onClick={() => setShowLeftPanel(false)} />
        )}
        <div
          className={cn(
            'min-h-0 flex-1',
            isNarrow
              ? showLeftPanel
                ? 'absolute left-0 top-0 z-10 h-full w-[217px] rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg shadow-lg backdrop-blur-sm'
                : 'hidden'
              : '',
          )}
        >
          {left}
        </div>
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        {children({ isNarrow, onOpenMenu: () => setShowLeftPanel(true), onClose })}
      </div>
    </div>
  )
}

export default SplitPanel
