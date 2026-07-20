'use client'

import { Avatar } from '@langgenius/dify-ui/avatar'
import { cn } from '@langgenius/dify-ui/cn'
import { useSuspenseQuery } from '@tanstack/react-query'
import AccountDropdown from '@/app/components/header/account-dropdown'
import { userProfileQueryOptions } from '@/features/account-profile/client'

type AccountSectionProps = {
  compact?: boolean
}

const AccountSection = ({ compact = false }: AccountSectionProps) => {
  const { data: userProfile } = useSuspenseQuery({
    ...userProfileQueryOptions(),
    select: (data) => data.profile,
  })

  return (
    <AccountDropdown
      variant="mainNav"
      trigger={({ isOpen, ariaLabel }) => (
        <button
          type="button"
          aria-label={ariaLabel}
          title={userProfile.name}
          className={cn(
            'flex min-w-0 shrink items-center rounded-full text-left text-components-main-nav-text transition-colors hover:bg-state-base-hover focus-visible:inset-ring-2 focus-visible:inset-ring-state-accent-solid focus-visible:outline-hidden disabled:cursor-default disabled:hover:bg-transparent',
            compact ? 'justify-center p-1' : 'max-w-[180px] gap-3 py-1 pr-4 pl-1',
            isOpen && 'bg-state-base-hover',
          )}
        >
          <Avatar
            avatar={userProfile.avatar_url}
            name={userProfile.name}
            size="md"
            className="size-7"
          />
          {!compact && (
            <span className="min-w-0 flex-1 truncate system-md-medium" title={userProfile.name}>
              {userProfile.name}
            </span>
          )}
        </button>
      )}
    />
  )
}

export default AccountSection
