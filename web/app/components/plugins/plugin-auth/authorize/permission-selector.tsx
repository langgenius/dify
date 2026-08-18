import { Avatar } from '@langgenius/dify-ui/avatar'
import { cn } from '@langgenius/dify-ui/cn'
import {
  Popover,
  PopoverClose,
  PopoverContent,
  PopoverTitle,
  PopoverTrigger,
} from '@langgenius/dify-ui/popover'
import { RadioGroup, RadioItem } from '@langgenius/dify-ui/radio'
import { useAtomValue } from 'jotai'
import { useTranslation } from 'react-i18next'
import { userProfileAtom } from '@/context/account-state'
import { PermissionLevel } from '@/models/permission'

export type CredentialPermission =
  | typeof PermissionLevel.onlyMe
  | typeof PermissionLevel.allTeamMembers

type PermissionSelectorProps = {
  disabled?: boolean
  permission: CredentialPermission
  onChange: (permission: CredentialPermission) => void
}

const optionClassName =
  'flex w-full touch-manipulation cursor-pointer items-center gap-x-1 rounded-lg border-none bg-transparent px-2 py-1 text-left outline-hidden hover:bg-state-base-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid'

const PermissionSelector = ({ disabled, permission, onChange }: PermissionSelectorProps) => {
  const { t } = useTranslation()
  const userProfile = useAtomValue(userProfileAtom)
  const isOnlyMe = permission === PermissionLevel.onlyMe
  const isAllTeamMembers = permission === PermissionLevel.allTeamMembers
  const permissionLabel = t(($) => $['auth.whoCanUse'], { ns: 'plugin' })

  return (
    <Popover>
      <PopoverTrigger
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
              {t(($) => $['form.permissionsOnlyMe'], { ns: 'datasetSettings' })}
            </div>
          </>
        )}
        {isAllTeamMembers && (
          <>
            <div className="flex size-6 shrink-0 items-center justify-center">
              <span aria-hidden="true" className="i-ri-group-2-line size-4 text-text-secondary" />
            </div>
            <div className="grow p-1 system-sm-regular text-components-input-text-filled">
              {t(($) => $['form.permissionsAllMember'], { ns: 'datasetSettings' })}
            </div>
          </>
        )}
        <span
          aria-hidden="true"
          className="i-ri-arrow-down-s-line size-4 shrink-0 text-text-quaternary group-data-disabled/permission-trigger:text-components-input-text-placeholder! group-data-popup-open/permission-trigger:text-text-secondary"
        />
      </PopoverTrigger>
      <PopoverContent placement="bottom-start" sideOffset={4} popupClassName="w-[480px] p-0">
        <PopoverTitle className="sr-only">{permissionLabel}</PopoverTitle>
        <RadioGroup<CredentialPermission>
          value={permission}
          onValueChange={onChange}
          aria-label={permissionLabel}
          className="flex-col items-stretch gap-0 p-1"
        >
          <PopoverClose
            render={<RadioItem<CredentialPermission> value={PermissionLevel.onlyMe} />}
            className={optionClassName}
          >
            <Avatar
              avatar={userProfile.avatar_url}
              name={userProfile.name}
              className="shrink-0"
              size="sm"
            />
            <div className="grow px-1 system-md-regular text-text-secondary">
              {t(($) => $['form.permissionsOnlyMe'], { ns: 'datasetSettings' })}
            </div>
            {isOnlyMe && (
              <span aria-hidden="true" className="i-ri-check-line size-4 text-text-accent" />
            )}
          </PopoverClose>
          <PopoverClose
            render={<RadioItem<CredentialPermission> value={PermissionLevel.allTeamMembers} />}
            className={optionClassName}
          >
            <div className="flex size-6 shrink-0 items-center justify-center">
              <span aria-hidden="true" className="i-ri-group-2-line size-4 text-text-secondary" />
            </div>
            <div className="grow px-1 system-md-regular text-text-secondary">
              {t(($) => $['form.permissionsAllMember'], { ns: 'datasetSettings' })}
            </div>
            {isAllTeamMembers && (
              <span aria-hidden="true" className="i-ri-check-line size-4 text-text-accent" />
            )}
          </PopoverClose>
        </RadioGroup>
      </PopoverContent>
    </Popover>
  )
}

export default PermissionSelector
