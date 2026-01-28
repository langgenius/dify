import type { FC, ReactNode } from 'react'
import type { InspectTab } from './types'
import { RiCloseLine } from '@remixicon/react'
import ActionButton from '@/app/components/base/action-button'
import TabHeader from './tab-header'

export type InspectHeaderProps = {
  activeTab: InspectTab
  onTabChange: (tab: InspectTab) => void
  onClose: () => void
  headerActions?: ReactNode
}

type InspectLayoutProps = InspectHeaderProps & {
  children: ReactNode
}

const InspectLayout: FC<InspectLayoutProps> = ({
  activeTab,
  onTabChange,
  onClose,
  headerActions,
  children,
}) => {
  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center justify-between">
        <TabHeader activeTab={activeTab} onTabChange={onTabChange}>
          {headerActions}
        </TabHeader>
        <div className="pr-2 pt-2">
          <ActionButton onClick={onClose} aria-label="Close">
            <RiCloseLine className="h-4 w-4" />
          </ActionButton>
        </div>
      </div>
      <div className="flex min-h-0 flex-1 flex-col">
        {children}
      </div>
    </div>
  )
}

export default InspectLayout
