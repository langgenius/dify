import { useTranslation } from 'react-i18next'
import cn from 'classnames'
import React, { useMemo, useState } from 'react'
import { useDebounceFn } from 'ahooks'
import { RiArrowDownSLine } from '@remixicon/react'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
  PortalToFollowElemTrigger,
} from '@/app/components/base/portal-to-follow-elem'
import Avatar from '@/app/components/base/avatar'
import Input from '@/app/components/base/input'
import { Check } from '@/app/components/base/icons/src/vender/line/general'
import { Users01, UsersPlus } from '@/app/components/base/icons/src/vender/solid/users'
import { DatasetPermission } from '@/models/datasets'
import { useAppContext } from '@/context/app-context'
import type { Member } from '@/models/common'
export type RoleSelectorProps = {
  disabled?: boolean
  permission?: DatasetPermission
  value: string[]
  memberList: Member[]
  onChange: (permission?: DatasetPermission) => void
  onMemberSelect: (v: string[]) => void
}

const PermissionSelector = ({ disabled, permission, value, memberList, onChange, onMemberSelect }: RoleSelectorProps) => {
  const { t } = useTranslation()
  const { userProfile } = useAppContext()
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
  const selectMember = (member: Member) => {
    if (value.includes(member.id))
      onMemberSelect(value.filter(v => v !== member.id))
    else
      onMemberSelect([...value, member.id])
  }

  const selectedMembers = useMemo(() => {
    return [
      userProfile,
      ...memberList.filter(member => member.id !== userProfile.id).filter(member => value.includes(member.id)),
    ].map(member => member.name).join(', ')
  }, [userProfile, value, memberList])

  const showMe = useMemo(() => {
    return userProfile.name.includes(searchKeywords) || userProfile.email.includes(searchKeywords)
  }, [searchKeywords, userProfile])

  const filteredMemberList = useMemo(() => {
    return memberList.filter(member => (member.name.includes(searchKeywords) || member.email.includes(searchKeywords)) && member.id !== userProfile.id && ['owner', 'admin', 'editor', 'dataset_operator'].includes(member.role))
  }, [memberList, searchKeywords, userProfile])

  const isOnlyMe = permission === DatasetPermission.onlyMe
  const isAllTeamMembers = permission === DatasetPermission.allTeamMembers
  const isPartialMembers = permission === DatasetPermission.partialMembers

  return (
    <PortalToFollowElem
      open={open}
      onOpenChange={setOpen}
      placement='bottom-start'
      offset={4}
    >
      <div className='relative'>
        <PortalToFollowElemTrigger
          onClick={() => !disabled && setOpen(v => !v)}
          className='block'
        >
          <div className={cn('flex cursor-pointer items-center rounded-lg bg-components-input-bg-normal px-3 py-[6px] hover:bg-state-base-hover-alt',
            open && 'bg-state-base-hover-alt',
            disabled && '!cursor-not-allowed !bg-components-input-bg-disabled hover:!bg-components-input-bg-disabled',
          )}>
            {
              isOnlyMe && (
                <>
                  <Avatar avatar={userProfile.avatar_url} name={userProfile.name} className='mr-2 shrink-0' size={24} />
                  <div className='mr-2 grow text-sm leading-5 text-components-input-text-filled'>{t('datasetSettings.form.permissionsOnlyMe')}</div>
                </>
              )
            }
            {
              isAllTeamMembers && (
                <>
                  <div className='mr-2 flex h-6 w-6 items-center justify-center rounded-lg bg-[#EEF4FF]'>
                    <Users01 className='h-3.5 w-3.5 text-[#444CE7]' />
                  </div>
                  <div className='mr-2 grow text-sm leading-5 text-components-input-text-filled'>{t('datasetSettings.form.permissionsAllMember')}</div>
                </>
              )
            }
            {
              isPartialMembers && (
                <>
                  <div className='mr-2 flex h-6 w-6 items-center justify-center rounded-lg bg-[#EEF4FF]'>
                    <Users01 className='h-3.5 w-3.5 text-[#444CE7]' />
                  </div>
                  <div title={selectedMembers} className='mr-2 grow truncate text-sm leading-5 text-components-input-text-filled'>{selectedMembers}</div>
                </>
              )
            }
            <RiArrowDownSLine className={cn('h-4 w-4 shrink-0 text-text-secondary', disabled && '!text-components-input-text-placeholder')} />
          </div>
        </PortalToFollowElemTrigger>
        <PortalToFollowElemContent className='z-[1002]'>
          <div className='relative w-[480px] rounded-lg border-[0.5px] border-components-panel-border bg-components-panel-bg-blur shadow-lg backdrop-blur-sm'>
            <div className='p-1'>
              <div className='cursor-pointer rounded-lg py-1 pl-3 pr-2 hover:bg-gray-50' onClick={() => {
                onChange(DatasetPermission.onlyMe)
                setOpen(false)
              }}>
                <div className='flex items-center gap-2'>
                  <Avatar avatar={userProfile.avatar_url} name={userProfile.name} className='mr-2 shrink-0' size={24} />
                  <div className='mr-2 grow text-sm leading-5 text-gray-900'>{t('datasetSettings.form.permissionsOnlyMe')}</div>
                  {isOnlyMe && <Check className='h-4 w-4 text-primary-600' />}
                </div>
              </div>
              <div className='cursor-pointer rounded-lg py-1 pl-3 pr-2 hover:bg-gray-50' onClick={() => {
                onChange(DatasetPermission.allTeamMembers)
                setOpen(false)
              }}>
                <div className='flex items-center gap-2'>
                  <div className='mr-2 flex h-6 w-6 items-center justify-center rounded-lg bg-[#EEF4FF]'>
                    <Users01 className='h-3.5 w-3.5 text-[#444CE7]' />
                  </div>
                  <div className='mr-2 grow text-sm leading-5 text-gray-900'>{t('datasetSettings.form.permissionsAllMember')}</div>
                  {isAllTeamMembers && <Check className='h-4 w-4 text-primary-600' />}
                </div>
              </div>
              <div className='cursor-pointer rounded-lg py-1 pl-3 pr-2 hover:bg-gray-50' onClick={() => {
                onChange(DatasetPermission.partialMembers)
                onMemberSelect([userProfile.id])
              }}>
                <div className='flex items-center gap-2'>
                  <div className={cn('mr-2 flex h-6 w-6 items-center justify-center rounded-lg bg-[#FFF6ED]', isPartialMembers && '!bg-[#EEF4FF]')}>
                    <UsersPlus className={cn('h-3.5 w-3.5 text-[#FB6514]', isPartialMembers && '!text-[#444CE7]')} />
                  </div>
                  <div className='mr-2 grow text-sm leading-5 text-gray-900'>{t('datasetSettings.form.permissionsInvitedMembers')}</div>
                  {isPartialMembers && <Check className='h-4 w-4 text-primary-600' />}
                </div>
              </div>
            </div>
            {isPartialMembers && (
              <div className='max-h-[360px] overflow-y-auto border-t-[1px] border-gray-100 p-1'>
                <div className='sticky left-0 top-0 bg-white p-2 pb-1'>
                  <Input
                    showLeftIcon
                    showClearIcon
                    value={keywords}
                    onChange={e => handleKeywordsChange(e.target.value)}
                    onClear={() => handleKeywordsChange('')}
                  />
                </div>
                {showMe && (
                  <div className='flex items-center gap-2 rounded-lg py-1 pl-3 pr-[10px]'>
                    <Avatar avatar={userProfile.avatar_url} name={userProfile.name} className='shrink-0' size={24} />
                    <div className='grow'>
                      <div className='truncate text-[13px] font-medium leading-[18px] text-text-secondary'>
                        {userProfile.name}
                        <span className='text-xs font-normal text-text-tertiary'>{t('datasetSettings.form.me')}</span>
                      </div>
                      <div className='truncate text-xs leading-[18px] text-text-tertiary'>{userProfile.email}</div>
                    </div>
                    <Check className='h-4 w-4 shrink-0 text-text-accent opacity-30' />
                  </div>
                )}
                {filteredMemberList.map(member => (
                  <div key={member.id} className='flex cursor-pointer items-center gap-2 rounded-lg py-1 pl-3 pr-[10px] hover:bg-state-base-hover' onClick={() => selectMember(member)}>
                    <Avatar avatar={userProfile.avatar_url} name={member.name} className='shrink-0' size={24} />
                    <div className='grow'>
                      <div className='truncate text-[13px] font-medium leading-[18px] text-text-secondary'>{member.name}</div>
                      <div className='truncate text-xs leading-[18px] text-text-tertiary'>{member.email}</div>
                    </div>
                    {value.includes(member.id) && <Check className='h-4 w-4 shrink-0 text-text-accent' />}
                  </div>
                ))}
              </div>
            )}
          </div>
        </PortalToFollowElemContent>
      </div>
    </PortalToFollowElem>
  )
}

export default PermissionSelector
