import type { CredentialPermission } from '@/models/permission'
import { Avatar } from '@langgenius/dify-ui/avatar'
import { cn } from '@langgenius/dify-ui/cn'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuRadioItemIndicator,
  DropdownMenuTrigger,
} from '@langgenius/dify-ui/dropdown-menu'
import { useSuspenseQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { userProfileQueryOptions } from '@/features/account-profile/client'
import { PermissionLevel } from '@/models/permission'

type PermissionSelectorProps = {
  disabled?: boolean
  permission: CredentialPermission
  onChange: (permission: CredentialPermission) => void
}

const PermissionSelector = ({ disabled, permission, onChange }: PermissionSelectorProps) => {
  const { t } = useTranslation()
  const { data: userProfile } = useSuspenseQuery({
    ...userProfileQueryOptions(),
    select: (data) => data.profile,
  })
  const isOnlyMe = permission === PermissionLevel.onlyMe
  const isAllTeamMembers = permission === PermissionLevel.allTeamMembers
  const permissionLabel = t(($) => $['auth.whoCanUse'], { ns: 'plugin' })
  const onlyMeLabel = t(($) => $['form.permissionsOnlyMe'], { ns: 'datasetSettings' })
  const allTeamMembersLabel = t(($) => $['form.permissionsAllMember'], {
    ns: 'datasetSettings',
  })
  const selectedPermissionLabel = isOnlyMe ? onlyMeLabel : allTeamMembersLabel

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={`${permissionLabel}: ${selectedPermissionLabel}`}
        disabled={disabled}
        className={cn(
          'group/permission-trigger flex w-full cursor-pointer touch-manipulation items-center gap-x-0.5 rounded-lg bg-components-input-bg-normal px-2 py-1 text-left outline-hidden hover:bg-state-base-hover-alt focus-visible:ring-2 focus-visible:ring-state-accent-solid data-popup-open:bg-state-base-hover-alt',
          'data-disabled:cursor-not-allowed! data-disabled:bg-components-input-bg-disabled! data-disabled:hover:bg-components-input-bg-disabled!',
        )}
      >
        {isOnlyMe && (
          <>
            <div className="flex size-6 shrink-0 items-center justify-center">
              <Avatar avatar={userProfile.avatar_url} name={userProfile.name} size="xs" />
            </div>
            <div className="grow p-1 system-sm-regular text-components-input-text-filled">
              {onlyMeLabel}
            </div>
          </>
        )}
        {isAllTeamMembers && (
          <>
            <div className="flex size-6 shrink-0 items-center justify-center">
              <span aria-hidden="true" className="i-ri-group-2-line size-4 text-text-secondary" />
            </div>
            <div className="grow p-1 system-sm-regular text-components-input-text-filled">
              {allTeamMembersLabel}
            </div>
          </>
        )}
        <span
          aria-hidden="true"
          className="i-ri-arrow-down-s-line size-4 shrink-0 text-text-quaternary group-data-disabled/permission-trigger:text-components-input-text-placeholder! group-data-popup-open/permission-trigger:text-text-secondary"
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        placement="bottom-start"
        sideOffset={4}
        className="w-(--anchor-width) max-w-(--available-width)"
      >
        <DropdownMenuRadioGroup<CredentialPermission>
          value={permission}
          onValueChange={onChange}
          aria-label={permissionLabel}
        >
          <DropdownMenuRadioItem<CredentialPermission>
            aria-label={onlyMeLabel}
            value={PermissionLevel.onlyMe}
            closeOnClick
            className="touch-manipulation"
          >
            <Avatar
              avatar={userProfile.avatar_url}
              name={userProfile.name}
              className="shrink-0"
              size="sm"
            />
            <div className="min-w-0 grow px-1 system-md-regular text-text-secondary">
              {onlyMeLabel}
            </div>
            <DropdownMenuRadioItemIndicator />
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem<CredentialPermission>
            aria-label={allTeamMembersLabel}
            value={PermissionLevel.allTeamMembers}
            closeOnClick
            className="touch-manipulation"
          >
            <div className="flex size-6 shrink-0 items-center justify-center">
              <span aria-hidden="true" className="i-ri-group-2-line size-4 text-text-secondary" />
            </div>
            <div className="min-w-0 grow px-1 system-md-regular text-text-secondary">
              {allTeamMembersLabel}
            </div>
            <DropdownMenuRadioItemIndicator />
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export default PermissionSelector
