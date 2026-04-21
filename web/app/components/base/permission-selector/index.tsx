import type { Member } from '@/models/common'
import { RiArrowDownSLine, RiGroup2Line, RiLock2Line } from '@remixicon/react'
import { useDebounceFn } from 'ahooks'
import * as React from 'react'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Avatar } from '@langgenius/dify-ui/avatar'
import Input from '@/app/components/base/input'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@langgenius/dify-ui/popover'
import { useSelector as useAppContextWithSelector } from '@/context/app-context'
import { PermissionLevel } from '@/models/permission'
import { cn } from '@langgenius/dify-ui/cn'
import MemberItem from './member-item'
import Item from './permission-item'

type PermissionSelectorProps = {
  disabled?: boolean
  permission?: PermissionLevel
  value: string[]
  memberList: Member[]
  onChange: (permission?: PermissionLevel) => void
  onMemberSelect: (v: string[]) => void
  /** i18n namespace for label strings (defaults to datasetSettings for backward compat) */
  i18nNamespace?: string
}

const PermissionSelector = ({
  disabled,
  permission,
  value,
  memberList,
  onChange,
  onMemberSelect,
  i18nNamespace = 'datasetSettings',
}: PermissionSelectorProps) => {
  const { t } = useTranslation()
  const userProfile = useAppContextWithSelector(state => state.userProfile)
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
    return memberList.filter(member => (member.name.includes(searchKeywords) || member.email.includes(searchKeywords)) && member.id !== userProfile.id && ['owner', 'admin', 'editor', 'dataset_operator'].includes(member.role))
  }, [memberList, searchKeywords, userProfile])

  const onSelectOnlyMe = useCallback(() => {
    onChange(PermissionLevel.onlyMe)
    setOpen(false)
  }, [onChange])

  const onSelectAllMembers = useCallback(() => {
    onChange(PermissionLevel.allTeamMembers)
    setOpen(false)
  }, [onChange])

  const onSelectPartialMembers = useCallback(() => {
    onChange(PermissionLevel.partialMembers)
    onMemberSelect([userProfile.id])
  }, [onChange, onMemberSelect, userProfile])

  const isOnlyMe = permission === PermissionLevel.onlyMe
  const isAllTeamMembers = permission === PermissionLevel.allTeamMembers
  const isPartialMembers = permission === PermissionLevel.partialMembers
  const selectedMemberNames = selectedMembers.map(member => member.name).join(', ')

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <div className="relative">
        <PopoverTrigger
          disabled={disabled}
          render={(
            <div
              className={cn(
                'flex cursor-pointer items-center gap-x-0.5 rounded-lg bg-components-input-bg-normal px-2 py-1 hover:bg-state-base-hover-alt',
                open && 'bg-state-base-hover-alt',
                disabled && 'cursor-not-allowed! bg-components-input-bg-disabled! hover:bg-components-input-bg-disabled!',
              )}
            />
          )}
        >
          {
            isOnlyMe && (
              <>
                <div className="flex size-6 shrink-0 items-center justify-center">
                  <Avatar avatar={userProfile.avatar_url} name={userProfile.name} size="xs" />
                </div>
                <div className="grow p-1 text-components-input-text-filled system-sm-regular">
                  {t('form.permissionsOnlyMe', { ns: i18nNamespace })}
                </div>
              </>
            )
          }
          {
            isAllTeamMembers && (
              <>
                <div className="flex size-6 shrink-0 items-center justify-center">
                  <RiGroup2Line className="size-4 text-text-secondary" />
                </div>
                <div className="grow p-1 text-components-input-text-filled system-sm-regular">
                  {t('form.permissionsAllMember', { ns: i18nNamespace })}
                </div>
              </>
            )
          }
          {
            isPartialMembers && (
              <>
                <div className="relative flex size-6 shrink-0 items-center justify-center">
                  {
                    selectedMembers.length === 1 && (
                      <Avatar
                        avatar={selectedMembers[0].avatar_url}
                        name={selectedMembers[0].name}
                        size="xs"
                      />
                    )
                  }
                  {
                    selectedMembers.length >= 2 && (
                      <>
                        <Avatar
                          avatar={selectedMembers[0].avatar_url}
                          name={selectedMembers[0].name}
                          className="absolute left-0 top-0 z-0"
                          size="xxs"
                        />
                        <Avatar
                          avatar={selectedMembers[1].avatar_url}
                          name={selectedMembers[1].name}
                          className="absolute bottom-0 right-0 z-10"
                          size="xxs"
                        />
                      </>
                    )
                  }
                </div>
                <div
                  title={selectedMemberNames}
                  className="grow truncate p-1 text-components-input-text-filled system-sm-regular"
                >
                  {selectedMemberNames}
                </div>
              </>
            )
          }
          <RiArrowDownSLine
            className={cn(
              'h-4 w-4 shrink-0 text-text-quaternary group-hover:text-text-secondary',
              open && 'text-text-secondary',
              disabled && 'text-components-input-text-placeholder!',
            )}
          />
        </PopoverTrigger>
        <PopoverContent placement="bottom-start" sideOffset={4} popupClassName="w-[480px] p-0">
          <div className="p-1">
            {/* Only me */}
            <Item
              leftIcon={
                <Avatar avatar={userProfile.avatar_url} name={userProfile.name} className="shrink-0" size="sm" />
              }
              text={t('form.permissionsOnlyMe', { ns: i18nNamespace })}
              onClick={onSelectOnlyMe}
              isSelected={isOnlyMe}
            />
            {/* All team members */}
            <Item
              leftIcon={(
                <div className="flex size-6 shrink-0 items-center justify-center">
                  <RiGroup2Line className="size-4 text-text-secondary" />
                </div>
              )}
              text={t('form.permissionsAllMember', { ns: i18nNamespace })}
              onClick={onSelectAllMembers}
              isSelected={isAllTeamMembers}
            />
            {/* Partial members */}
            <Item
              leftIcon={(
                <div className="flex size-6 shrink-0 items-center justify-center">
                  <RiLock2Line className="size-4 text-text-secondary" />
                </div>
              )}
              text={t('form.permissionsInvitedMembers', { ns: i18nNamespace })}
              onClick={onSelectPartialMembers}
              isSelected={isPartialMembers}
            />
          </div>
          {isPartialMembers && (
            <div className="max-h-[360px] overflow-y-auto border-t border-divider-regular pb-1 pl-1 pr-1">
              <div className="sticky left-0 top-0 z-10 bg-components-panel-on-panel-item-bg p-2 pb-1">
                <Input
                  showLeftIcon
                  showClearIcon
                  value={keywords}
                  onChange={e => handleKeywordsChange(e.target.value)}
                  onClear={() => handleKeywordsChange('')}
                />
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
                    i18nNamespace={i18nNamespace}
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
                    i18nNamespace={i18nNamespace}
                  />
                ))}
                {
                  !showMe && filteredMemberList.length === 0 && (
                    <div className="flex items-center justify-center whitespace-pre-wrap px-1 py-6 text-center text-text-tertiary system-xs-regular">
                      {t('form.onSearchResults', { ns: i18nNamespace })}
                    </div>
                  )
                }
              </div>
            </div>
          )}
        </PopoverContent>
      </div>
    </Popover>
  )
}

export default PermissionSelector
