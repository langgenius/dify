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
import type { DatasetPermission } from '@/models/datasets'
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
          {permission === 'only_me' && (
            <div className={cn('flex items-center px-3 py-[6px] rounded-lg bg-gray-100 cursor-pointer hover:bg-gray-200', open && 'bg-gray-200', disabled && 'hover:!bg-gray-100 !cursor-default')}>
              <Avatar avatar={userProfile.avatar_url} name={userProfile.name} className='shrink-0 mr-2' size={24} />
              <div className='grow mr-2 text-gray-900 text-sm leading-5'>{t('datasetSettings.form.permissionsOnlyMe')}</div>
              {!disabled && <RiArrowDownSLine className='shrink-0 w-4 h-4 text-gray-700' />}
            </div>
          )}
          {permission === 'all_team_members' && (
            <div className={cn('flex items-center px-3 py-[6px] rounded-lg bg-gray-100 cursor-pointer hover:bg-gray-200', open && 'bg-gray-200')}>
              <div className='mr-2 flex items-center justify-center w-6 h-6 rounded-lg bg-[#EEF4FF]'>
                <Users01 className='w-3.5 h-3.5 text-[#444CE7]' />
              </div>
              <div className='grow mr-2 text-gray-900 text-sm leading-5'>{t('datasetSettings.form.permissionsAllMember')}</div>
              {!disabled && <RiArrowDownSLine className='shrink-0 w-4 h-4 text-gray-700' />}
            </div>
          )}
          {permission === 'partial_members' && (
            <div className={cn('flex items-center px-3 py-[6px] rounded-lg bg-gray-100 cursor-pointer hover:bg-gray-200', open && 'bg-gray-200')}>
              <div className='mr-2 flex items-center justify-center w-6 h-6 rounded-lg bg-[#EEF4FF]'>
                <Users01 className='w-3.5 h-3.5 text-[#444CE7]' />
              </div>
              <div title={selectedMembers} className='grow mr-2 text-gray-900 text-sm leading-5 truncate'>{selectedMembers}</div>
              {!disabled && <RiArrowDownSLine className='shrink-0 w-4 h-4 text-gray-700' />}
            </div>
          )}
        </PortalToFollowElemTrigger>
        <PortalToFollowElemContent className='z-[1002]'>
          <div className='relative w-[480px] rounded-lg border-[0.5px] bg-white shadow-lg'>
            <div className='p-1'>
              <div className='pl-3 pr-2 py-1 rounded-lg hover:bg-gray-50 cursor-pointer' onClick={() => {
                onChange('only_me')
                setOpen(false)
              }}>
                <div className='flex items-center gap-2'>
                  <Avatar avatar={userProfile.avatar_url} name={userProfile.name} className='shrink-0 mr-2' size={24} />
                  <div className='grow mr-2 text-gray-900 text-sm leading-5'>{t('datasetSettings.form.permissionsOnlyMe')}</div>
                  {permission === 'only_me' && <Check className='w-4 h-4 text-primary-600' />}
                </div>
              </div>
              <div className='pl-3 pr-2 py-1 rounded-lg hover:bg-gray-50 cursor-pointer' onClick={() => {
                onChange('all_team_members')
                setOpen(false)
              }}>
                <div className='flex items-center gap-2'>
                  <div className='mr-2 flex items-center justify-center w-6 h-6 rounded-lg bg-[#EEF4FF]'>
                    <Users01 className='w-3.5 h-3.5 text-[#444CE7]' />
                  </div>
                  <div className='grow mr-2 text-gray-900 text-sm leading-5'>{t('datasetSettings.form.permissionsAllMember')}</div>
                  {permission === 'all_team_members' && <Check className='w-4 h-4 text-primary-600' />}
                </div>
              </div>
              <div className='pl-3 pr-2 py-1 rounded-lg hover:bg-gray-50 cursor-pointer' onClick={() => {
                onChange('partial_members')
                onMemberSelect([userProfile.id])
              }}>
                <div className='flex items-center gap-2'>
                  <div className={cn('mr-2 flex items-center justify-center w-6 h-6 rounded-lg bg-[#FFF6ED]', permission === 'partial_members' && '!bg-[#EEF4FF]')}>
                    <UsersPlus className={cn('w-3.5 h-3.5 text-[#FB6514]', permission === 'partial_members' && '!text-[#444CE7]')} />
                  </div>
                  <div className='grow mr-2 text-gray-900 text-sm leading-5'>{t('datasetSettings.form.permissionsInvitedMembers')}</div>
                  {permission === 'partial_members' && <Check className='w-4 h-4 text-primary-600' />}
                </div>
              </div>
            </div>
            {permission === 'partial_members' && (
              <div className='max-h-[360px] border-t-[1px] border-gray-100 p-1 overflow-y-auto'>
                <div className='sticky left-0 top-0 p-2 pb-1 bg-white'>
                  <Input
                    showLeftIcon
                    showClearIcon
                    value={keywords}
                    onChange={e => handleKeywordsChange(e.target.value)}
                    onClear={() => handleKeywordsChange('')}
                  />
                </div>
                {showMe && (
                  <div className='pl-3 pr-[10px] py-1 flex gap-2 items-center rounded-lg'>
                    <Avatar avatar={userProfile.avatar_url} name={userProfile.name} className='shrink-0' size={24} />
                    <div className='grow'>
                      <div className='text-[13px] text-gray-700 font-medium leading-[18px] truncate'>
                        {userProfile.name}
                        <span className='text-xs text-gray-500 font-normal'>{t('datasetSettings.form.me')}</span>
                      </div>
                      <div className='text-xs text-gray-500 leading-[18px] truncate'>{userProfile.email}</div>
                    </div>
                    <Check className='shrink-0 w-4 h-4 text-primary-600 opacity-30' />
                  </div>
                )}
                {filteredMemberList.map(member => (
                  <div key={member.id} className='pl-3 pr-[10px] py-1 flex gap-2 items-center rounded-lg hover:bg-gray-100 cursor-pointer' onClick={() => selectMember(member)}>
                    <Avatar avatar={userProfile.avatar_url} name={member.name} className='shrink-0' size={24} />
                    <div className='grow'>
                      <div className='text-[13px] text-gray-700 font-medium leading-[18px] truncate'>{member.name}</div>
                      <div className='text-xs text-gray-500 leading-[18px] truncate'>{member.email}</div>
                    </div>
                    {value.includes(member.id) && <Check className='shrink-0 w-4 h-4 text-primary-600' />}
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
