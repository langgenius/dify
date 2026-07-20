import type { Member } from '@/models/common'
import { Avatar } from '@langgenius/dify-ui/avatar'
import { cn } from '@langgenius/dify-ui/cn'
import { Input } from '@langgenius/dify-ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@langgenius/dify-ui/popover'
import { useDebounceFn } from 'ahooks'
import { useAtomValue } from 'jotai'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { userProfileAtom } from '@/context/account-state'
import { datasetRbacEnabledAtom } from '@/context/system-features-state'
import { DatasetPermission } from '@/models/datasets'
import MemberItem from './member-item'
import PermissionItem from './permission-item'

type PermissionSelectorProps = {
  disabled?: boolean
  permission?: DatasetPermission
  value: string[]
  memberList: Member[]
  onChange: (permission?: DatasetPermission) => void
  onMemberSelect: (value: string[]) => void
}

const PermissionSelector = ({
  disabled,
  permission,
  value,
  memberList,
  onChange,
  onMemberSelect,
}: PermissionSelectorProps) => {
  const { t } = useTranslation()
  const userProfile = useAtomValue(userProfileAtom)
  const isRbacEnabled = useAtomValue(datasetRbacEnabledAtom)
  const [keywords, setKeywords] = useState('')
  const [searchKeywords, setSearchKeywords] = useState('')
  const { run: handleSearch } = useDebounceFn(
    (nextKeywords: string) => {
      setSearchKeywords(nextKeywords)
    },
    { wait: 500 },
  )
  const handleKeywordsChange = (nextKeywords: string) => {
    setKeywords(nextKeywords)
    handleSearch(nextKeywords)
  }
  const selectMember = (member: Member) => {
    if (value.includes(member.id)) onMemberSelect(value.filter((id) => id !== member.id))
    else onMemberSelect([...value, member.id])
  }

  const selectedMembers = useMemo(
    () => [
      userProfile,
      ...memberList.filter((member) => member.id !== userProfile.id && value.includes(member.id)),
    ],
    [memberList, userProfile, value],
  )
  const filteredMemberList = useMemo(
    () =>
      memberList.filter(
        (member) =>
          member.id !== userProfile.id &&
          (member.name.includes(searchKeywords) || member.email.includes(searchKeywords)),
      ),
    [memberList, searchKeywords, userProfile.id],
  )

  const isOnlyMe = permission === DatasetPermission.onlyMe
  const isAllTeamMembers = permission === DatasetPermission.allTeamMembers
  const isPartialMembers = permission === DatasetPermission.partialMembers
  const showMe =
    userProfile.name.includes(searchKeywords) || userProfile.email.includes(searchKeywords)
  const selectedMemberNames = selectedMembers.map((member) => member.name).join(', ')
  const isDisabledByRbac = isRbacEnabled
  const isDisabled = disabled || isDisabledByRbac

  return (
    <Popover>
      <PopoverTrigger
        disabled={isDisabled}
        className={cn(
          'group/permission-trigger flex w-full cursor-pointer touch-manipulation items-center gap-x-0.5 rounded-lg bg-components-input-bg-normal px-2 py-1 text-left outline-hidden hover:bg-state-base-hover-alt focus-visible:ring-2 focus-visible:ring-state-accent-solid data-popup-open:bg-state-base-hover-alt',
          'data-disabled:cursor-not-allowed! data-disabled:bg-components-input-bg-disabled! data-disabled:hover:bg-components-input-bg-disabled!',
        )}
      >
        {isDisabledByRbac && (
          <>
            <div className="flex size-6 shrink-0 items-center justify-center">
              <span aria-hidden="true" className="i-ri-lock-2-line size-4 text-text-tertiary" />
            </div>
            <div className="grow p-1 system-sm-regular text-components-input-text-placeholder">
              {t(($) => $['form.permissionsAccessConfig'], { ns: 'datasetSettings' })}
            </div>
          </>
        )}
        {!isDisabledByRbac && isOnlyMe && (
          <>
            <div className="flex size-6 shrink-0 items-center justify-center">
              <Avatar avatar={userProfile.avatar_url} name={userProfile.name} size="xs" />
            </div>
            <div className="grow p-1 system-sm-regular text-components-input-text-filled">
              {t(($) => $['form.permissionsOnlyMe'], { ns: 'datasetSettings' })}
            </div>
          </>
        )}
        {!isDisabledByRbac && isAllTeamMembers && (
          <>
            <div className="flex size-6 shrink-0 items-center justify-center">
              <span aria-hidden="true" className="i-ri-group-2-line size-4 text-text-secondary" />
            </div>
            <div className="grow p-1 system-sm-regular text-components-input-text-filled">
              {t(($) => $['form.permissionsAllMember'], { ns: 'datasetSettings' })}
            </div>
          </>
        )}
        {!isDisabledByRbac && isPartialMembers && (
          <>
            <div className="relative flex size-6 shrink-0 items-center justify-center">
              {selectedMembers.length === 1 && (
                <Avatar
                  avatar={selectedMembers[0]!.avatar_url}
                  name={selectedMembers[0]!.name}
                  size="xs"
                />
              )}
              {selectedMembers.length >= 2 && (
                <>
                  <Avatar
                    avatar={selectedMembers[0]!.avatar_url}
                    name={selectedMembers[0]!.name}
                    className="absolute top-0 left-0 z-0"
                    size="xxs"
                  />
                  <Avatar
                    avatar={selectedMembers[1]!.avatar_url}
                    name={selectedMembers[1]!.name}
                    className="absolute right-0 bottom-0 z-10"
                    size="xxs"
                  />
                </>
              )}
            </div>
            <div
              title={selectedMemberNames}
              className="min-w-0 grow truncate p-1 system-sm-regular text-components-input-text-filled"
            >
              {selectedMemberNames}
            </div>
          </>
        )}
        <span
          aria-hidden="true"
          className={cn(
            'i-ri-arrow-down-s-line size-4 shrink-0 text-text-quaternary',
            'group-hover/permission-trigger:text-text-secondary group-data-popup-open/permission-trigger:text-text-secondary',
            'group-data-disabled/permission-trigger:text-components-input-text-placeholder!',
          )}
        />
      </PopoverTrigger>
      <PopoverContent
        placement="bottom-start"
        sideOffset={4}
        popupClassName="border-none bg-transparent shadow-none"
      >
        <div className="relative w-[480px] rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg-blur shadow-lg shadow-shadow-shadow-5">
          <div className="p-1">
            <PermissionItem
              closeOnSelect
              leftIcon={
                <Avatar
                  avatar={userProfile.avatar_url}
                  name={userProfile.name}
                  className="shrink-0"
                  size="sm"
                />
              }
              text={t(($) => $['form.permissionsOnlyMe'], { ns: 'datasetSettings' })}
              onClick={() => onChange(DatasetPermission.onlyMe)}
              isSelected={isOnlyMe}
            />
            <PermissionItem
              closeOnSelect
              leftIcon={
                <div className="flex size-6 shrink-0 items-center justify-center">
                  <span
                    aria-hidden="true"
                    className="i-ri-group-2-line size-4 text-text-secondary"
                  />
                </div>
              }
              text={t(($) => $['form.permissionsAllMember'], { ns: 'datasetSettings' })}
              onClick={() => onChange(DatasetPermission.allTeamMembers)}
              isSelected={isAllTeamMembers}
            />
            <PermissionItem
              leftIcon={
                <div className="flex size-6 shrink-0 items-center justify-center">
                  <span
                    aria-hidden="true"
                    className="i-ri-lock-2-line size-4 text-text-secondary"
                  />
                </div>
              }
              text={t(($) => $['form.permissionsInvitedMembers'], { ns: 'datasetSettings' })}
              onClick={() => {
                onChange(DatasetPermission.partialMembers)
                onMemberSelect([userProfile.id])
              }}
              isSelected={isPartialMembers}
            />
          </div>
          {isPartialMembers && (
            <div className="max-h-[360px] overflow-y-auto border-t border-divider-regular pr-1 pb-1 pl-1">
              <div className="sticky top-0 left-0 z-10 bg-components-panel-on-panel-item-bg p-2 pb-1">
                <div className="relative w-full">
                  <span
                    aria-hidden="true"
                    className="absolute top-1/2 left-2 i-ri-search-line size-4 -translate-y-1/2 text-components-input-text-placeholder"
                  />
                  <Input
                    aria-label={t(($) => $['operation.search'], { ns: 'common' })}
                    name="member-search"
                    autoComplete="off"
                    className={cn('w-full pl-[26px]', keywords && 'pr-[26px]')}
                    value={keywords}
                    placeholder={t(($) => $['operation.search'], { ns: 'common' }) || ''}
                    onChange={(event) => handleKeywordsChange(event.target.value)}
                  />
                  {!!keywords && (
                    <button
                      type="button"
                      aria-label={t(($) => $['operation.clear'], { ns: 'common' })}
                      className="group absolute top-1/2 right-2 -translate-y-1/2 cursor-pointer touch-manipulation border-none bg-transparent p-px outline-hidden focus-visible:ring-2 focus-visible:ring-state-accent-solid"
                      onClick={() => handleKeywordsChange('')}
                    >
                      <span
                        aria-hidden="true"
                        className="i-ri-close-circle-fill size-3.5 text-text-quaternary group-hover:text-text-tertiary"
                      />
                    </button>
                  )}
                </div>
              </div>
              <div className="flex flex-col p-1">
                {showMe && (
                  <MemberItem
                    leftIcon={
                      <Avatar
                        avatar={userProfile.avatar_url}
                        name={userProfile.name}
                        className="shrink-0"
                        size="sm"
                      />
                    }
                    name={userProfile.name}
                    email={userProfile.email}
                    isSelected
                    isMe
                  />
                )}
                {filteredMemberList.map((member) => (
                  <MemberItem
                    key={member.id}
                    leftIcon={
                      <Avatar
                        avatar={member.avatar_url}
                        name={member.name}
                        className="shrink-0"
                        size="sm"
                      />
                    }
                    name={member.name}
                    email={member.email}
                    isSelected={value.includes(member.id)}
                    onClick={() => selectMember(member)}
                  />
                ))}
                {!showMe && filteredMemberList.length === 0 && (
                  <div className="flex items-center justify-center px-1 py-6 text-center system-xs-regular whitespace-pre-wrap text-text-tertiary">
                    {t(($) => $['form.onSearchResults'], { ns: 'datasetSettings' })}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}

export default PermissionSelector
