'use client'

import type { Plan } from '@/app/components/billing/type'
import { Avatar } from '@langgenius/dify-ui/avatar'
import { cn } from '@langgenius/dify-ui/cn'
import AccountDropdown from '@/app/components/header/account-dropdown'
import { useAppContext } from '@/context/app-context'
import WorkspacePlanBadge from './workspace-plan-badge'

type AccountSectionProps = {
  workspacePlan: Plan
}

const AccountSection = ({
  workspacePlan,
}: AccountSectionProps) => {
  const { userProfile } = useAppContext()

  return (
    <AccountDropdown
      mainNavBadge={<WorkspacePlanBadge plan={workspacePlan} />}
      variant="mainNav"
      trigger={({ isOpen, ariaLabel }) => (
        <button
          type="button"
          aria-label={ariaLabel}
          title={userProfile.name}
          className={cn('text-components-main-nav-text flex max-w-[180px] min-w-0 shrink items-center gap-3 rounded-full py-1 pr-4 pl-1 text-left transition-colors hover:bg-state-base-hover', isOpen && 'bg-state-base-hover')}
        >
          <Avatar avatar={userProfile.avatar_url} name={userProfile.name} size="md" className="size-7" />
          <span className="min-w-0 flex-1 truncate system-md-medium">{userProfile.name}</span>
        </button>
      )}
    />
  )
}

export default AccountSection
