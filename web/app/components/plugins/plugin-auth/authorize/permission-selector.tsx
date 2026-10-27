import type { CredentialPermission } from '@/models/permission'
import { Avatar, AvatarFallback, AvatarImage } from '@langgenius/dify-ui/avatar'
import { cn } from '@langgenius/dify-ui/cn'
import {
  Menu,
  MenuContent,
  MenuRadioGroup,
  MenuRadioItem,
  MenuRadioItemIndicator,
  MenuTrigger,
} from '@langgenius/dify-ui/menu'
import { useSuspenseQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { userProfileQueryOptions } from '@/features/account-profile/client'
import { PermissionLevel } from '@/models/permission'
import { getAvatarInitial } from '@/utils/avatar'

type PermissionSelectorProps = {
  disabled?: boolean
  permission: CredentialPermission
  onChange: (permission: CredentialPermission) => void
}

const PermissionSelector = ({ disabled, permission, onChange }: PermissionSelectorProps) => {
  const { t } = useTranslation(['datasetSettings', 'plugin'])
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
    <Menu>
      <MenuTrigger
        aria-label={`${permissionLabel}: ${selectedPermissionLabel}`}
        disabled={disabled}
        className={cn(
          'group/permission-trigger flex w-full cursor-pointer touch-manipulation items-center gap-x-0.5 rounded-lg bg-components-input-bg-normal px-2 py-1 text-left hover:bg-state-base-hover-alt data-popup-open:bg-state-base-hover-alt',
          'data-disabled:cursor-not-allowed! data-disabled:bg-components-input-bg-disabled! data-disabled:hover:bg-components-input-bg-disabled!',
        )}
      >
        {isOnlyMe && (
          <>
            <div className="flex size-6 shrink-0 items-center justify-center">
              <Avatar size="xs" aria-hidden="true">
                <AvatarFallback>{getAvatarInitial(userProfile.name)}</AvatarFallback>
                <AvatarImage src={userProfile.avatar_url || undefined} alt="" />
              </Avatar>
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
      </MenuTrigger>
      <MenuContent align="start" className="w-(--anchor-width) max-w-(--available-width)">
        <MenuRadioGroup<CredentialPermission>
          value={permission}
          onValueChange={onChange}
          aria-label={permissionLabel}
        >
          <MenuRadioItem<CredentialPermission>
            aria-label={onlyMeLabel}
            value={PermissionLevel.onlyMe}
            closeOnClick
            className="touch-manipulation"
          >
            <Avatar className="shrink-0" size="sm" aria-hidden="true">
              <AvatarFallback>{getAvatarInitial(userProfile.name)}</AvatarFallback>
              <AvatarImage src={userProfile.avatar_url || undefined} alt="" />
            </Avatar>
            <div className="min-w-0 grow px-1 system-md-regular text-text-secondary">
              {onlyMeLabel}
            </div>
            <MenuRadioItemIndicator />
          </MenuRadioItem>
          <MenuRadioItem<CredentialPermission>
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
            <MenuRadioItemIndicator />
          </MenuRadioItem>
        </MenuRadioGroup>
      </MenuContent>
    </Menu>
  )
}

export default PermissionSelector
