import type { Member } from '@/models/common'
import { Avatar } from '@langgenius/dify-ui/avatar'
import { cn } from '@langgenius/dify-ui/cn'
import { Input } from '@langgenius/dify-ui/input'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@langgenius/dify-ui/popover'
import { useSuspenseQuery } from '@tanstack/react-query'
import { useDebounceFn } from 'ahooks'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from '#i18n'
import { useSelector as useAppContextWithSelector } from '@/context/app-context'
import { systemFeaturesQueryOptions } from '@/features/system-features/client'
import { DatasetPermission } from '@/models/datasets'
import MemberItem from './member-item'
import Item from './permission-item'

type RoleSelectorProps = {
  disabled?: boolean
  permission?: DatasetPermission
  value: string[]
  memberList: Member[]
  onChange: (permission?: DatasetPermission) => void
  onMemberSelect: (v: string[]) => void
}

const PermissionSelector = ({
  disabled,
  permission,
  value,
  memberList,
  onChange,
  onMemberSelect,
}: RoleSelectorProps) => {
  const { t } = useTranslation()
  const userProfile = useAppContextWithSelector(state => state.userProfile)
  const { data: systemFeatures } = useSuspenseQuery(systemFeaturesQueryOptions())
  const [open, setOpen] = useState(false)

  const [keywords, setKeywords] = useState('')
  const [searchKeywords, setSearchKeywords] = useState('')
  const { run: handleSearch } = useDebounceFn(() => {
    setSearchKeywords(keywords)
  }, { wait: 500 })
  const handleKeywordsChange = (value: string) => {
    setKeywords(value)
    handleSearch()
  }
  const selectMember = useCallback((member: Member) => {
    if (value.includes(member.id))
      onMemberSelect(value.filter(v => v !== member.id))
    else
      onMemberSelect([...value, member.id])
  }, [value, onMemberSelect])

  const selectedMembers = useMemo(() => {
    return [
      userProfile,
      ...memberList.filter(member => member.id !== userProfile.id).filter(member => value.includes(member.id)),
    ]
  }, [userProfile, value, memberList])

  const showMe = useMemo(() => {
    return userProfile.name.includes(searchKeywords) || userProfile.email.includes(searchKeywords)
  }, [searchKeywords, userProfile])

  const filteredMemberList = useMemo(() => {
    return memberList.filter(member => (member.name.includes(searchKeywords) || member.email.includes(searchKeywords)) && member.id !== userProfile.id)
  }, [memberList, searchKeywords, userProfile])

  const onSelectOnlyMe = useCallback(() => {
    onChange(DatasetPermission.onlyMe)
    setOpen(false)
  }, [onChange])

  const onSelectAllMembers = useCallback(() => {
    onChange(DatasetPermission.allTeamMembers)
    setOpen(false)
  }, [onChange])

  const onSelectPartialMembers = useCallback(() => {
    onChange(DatasetPermission.partialMembers)
    onMemberSelect([userProfile.id])
  }, [onChange, onMemberSelect, userProfile])

  const isOnlyMe = permission === DatasetPermission.onlyMe
  const isAllTeamMembers = permission === DatasetPermission.allTeamMembers
  const isPartialMembers = permission === DatasetPermission.partialMembers
  const selectedMemberNames = selectedMembers.map(member => member.name).join(', ')
  const isDisabledByRBAC = systemFeatures.rbac_enabled
  const isDisabled = disabled || isDisabledByRBAC

  return (
    <Popover
      open={open}
      onOpenChange={(nextOpen) => {
        if (isDisabled)
          return
        setOpen(nextOpen)
      }}
    >
      <div className="relative">
        <PopoverTrigger
          render={(
            <div className={cn('group flex cursor-pointer items-center gap-x-0.5 rounded-lg bg-components-input-bg-normal px-2 py-1 hover:bg-state-base-hover-alt data-popup-open:bg-state-base-hover-alt', isDisabled && 'cursor-not-allowed! bg-components-input-bg-disabled! hover:bg-components-input-bg-disabled!')}>
              {isDisabledByRBAC && (
                <>
                  <div className="flex size-6 shrink-0 items-center justify-center">
                    <span className="i-ri-lock-2-line size-4 text-text-tertiary" />
                  </div>
                  <div className="grow p-1 system-sm-regular text-components-input-text-placeholder">
                    {t('form.permissionsAccessConfig', { ns: 'datasetSettings' })}
                  </div>
                </>
              )}
              {
                !isDisabledByRBAC && isOnlyMe && (
                  <>
                    <div className="flex size-6 shrink-0 items-center justify-center">
                      <Avatar avatar={userProfile.avatar_url} name={userProfile.name} size="xs" />
                    </div>
                    <div className="grow p-1 system-sm-regular text-components-input-text-filled">
                      {t('form.permissionsOnlyMe', { ns: 'datasetSettings' })}
                    </div>
                  </>
                )
              }
              {
                !isDisabledByRBAC && isAllTeamMembers && (
                  <>
                    <div className="flex size-6 shrink-0 items-center justify-center">
                      <span className="i-ri-group-2-line size-4 text-text-secondary" />
                    </div>
                    <div className="grow p-1 system-sm-regular text-components-input-text-filled">
                      {t('form.permissionsAllMember', { ns: 'datasetSettings' })}
                    </div>
                  </>
                )
              }
              {
                !isDisabledByRBAC && isPartialMembers && (
                  <>
                    <div className="relative flex size-6 shrink-0 items-center justify-center">
                      {
                        selectedMembers.length === 1 && (
                          <Avatar
                            avatar={selectedMembers[0]!.avatar_url}
                            name={selectedMembers[0]!.name}
                            size="xs"
                          />
                        )
                      }
                      {
                        selectedMembers.length >= 2 && (
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
                        )
                      }
                    </div>
                    <div
                      title={selectedMemberNames}
                      className="grow truncate p-1 system-sm-regular text-components-input-text-filled"
                    >
                      {selectedMemberNames}
                    </div>
                  </>
                )
              }
              <span className={cn(
                'i-ri-arrow-down-s-line',
                'size-4 shrink-0 text-text-quaternary group-hover:text-text-secondary group-data-popup-open:text-text-secondary',
                isDisabled && 'text-components-input-text-placeholder!',
              )}
              />
            </div>
          )}
        />
        <PopoverContent
          placement="bottom-start"
          sideOffset={4}
          popupClassName="border-none bg-transparent shadow-none"
        >
          <div className="relative w-[480px] rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg-blur shadow-lg shadow-shadow-shadow-5">
            <div className="p-1">
              {/* Only me */}
              <Item
                leftIcon={
                  <Avatar avatar={userProfile.avatar_url} name={userProfile.name} className="shrink-0" size="sm" />
                }
                text={t('form.permissionsOnlyMe', { ns: 'datasetSettings' })}
                onClick={onSelectOnlyMe}
                isSelected={isOnlyMe}
              />
              {/* All team members */}
              <Item
                leftIcon={(
                  <div className="flex size-6 shrink-0 items-center justify-center">
                    <span className="i-ri-group-2-line size-4 text-text-secondary" />
                  </div>
                )}
                text={t('form.permissionsAllMember', { ns: 'datasetSettings' })}
                onClick={onSelectAllMembers}
                isSelected={isAllTeamMembers}
              />
              {/* Partial members */}
              <Item
                leftIcon={(
                  <div className="flex size-6 shrink-0 items-center justify-center">
                    <span className="i-ri-lock-2-line size-4 text-text-secondary" />
                  </div>
                )}
                text={t('form.permissionsInvitedMembers', { ns: 'datasetSettings' })}
                onClick={onSelectPartialMembers}
                isSelected={isPartialMembers}
              />
            </div>
            {isPartialMembers && (
              <div className="max-h-[360px] overflow-y-auto border-t border-divider-regular pr-1 pb-1 pl-1">
                <div className="sticky top-0 left-0 z-10 bg-components-panel-on-panel-item-bg p-2 pb-1">
                  <div className="relative w-full">
                    <span className="absolute top-1/2 left-2 i-ri-search-line size-4 -translate-y-1/2 text-components-input-text-placeholder" />
                    <Input
                      className={cn('w-full pl-[26px]', keywords && 'pr-[26px]')}
                      value={keywords}
                      placeholder={t('operation.search', { ns: 'common' }) || ''}
                      onChange={e => handleKeywordsChange(e.target.value)}
                    />
                    {!!keywords && (
                      <button
                        type="button"
                        aria-label={t('operation.clear', { ns: 'common' })}
                        className="group absolute top-1/2 right-2 -translate-y-1/2 cursor-pointer border-none bg-transparent p-px"
                        onClick={() => handleKeywordsChange('')}
                      >
                        <span className="i-ri-close-circle-fill size-3.5 cursor-pointer text-text-quaternary group-hover:text-text-tertiary" aria-hidden="true" />
                      </button>
                    )}
                  </div>
                </div>
                <div className="flex flex-col p-1">
                  {showMe && (
                    <MemberItem
                      leftIcon={
                        <Avatar avatar={userProfile.avatar_url} name={userProfile.name} className="shrink-0" size="sm" />
                      }
                      name={userProfile.name}
                      email={userProfile.email}
                      isSelected
                      isMe
                    />
                  )}
                  {filteredMemberList.map(member => (
                    <MemberItem
                      key={member.id}
                      leftIcon={
                        <Avatar avatar={member.avatar_url} name={member.name} className="shrink-0" size="sm" />
                      }
                      name={member.name}
                      email={member.email}
                      isSelected={value.includes(member.id)}
                      onClick={selectMember.bind(null, member)}
                    />
                  ))}
                  {
                    !showMe && filteredMemberList.length === 0 && (
                      <div className="flex items-center justify-center px-1 py-6 text-center system-xs-regular whitespace-pre-wrap text-text-tertiary">
                        {t('form.onSearchResults', { ns: 'datasetSettings' })}
                      </div>
                    )
                  }
                </div>
              </div>
            )}
          </div>
        </PopoverContent>
      </div>
    </Popover>
  )
}

export default PermissionSelector
