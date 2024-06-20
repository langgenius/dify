import { useTranslation } from 'react-i18next'
import cn from 'classnames'
import React, { useState } from 'react'
import { RiArrowDownSLine } from '@remixicon/react'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
  PortalToFollowElemTrigger,
} from '@/app/components/base/portal-to-follow-elem'
import { Check } from '@/app/components/base/icons/src/vender/line/general'
import Avatar from '@/app/components/base/avatar'
import { Users01, UsersPlus } from '@/app/components/base/icons/src/vender/solid/users'
import type { DatasetPermission } from '@/models/datasets'
import { useAppContext } from '@/context/app-context'

export type RoleSelectorProps = {
  disabled?: boolean
  permission?: DatasetPermission
  value: string[]
  onChange: (permission?: DatasetPermission) => void
}

const PermissionSelector = ({ disabled, permission, value, onChange }: RoleSelectorProps) => {
  const { t } = useTranslation()
  const { userProfile } = useAppContext()
  const [open, setOpen] = useState(false)

  const options = [
    {
      key: 'only_me',
      text: t('datasetSettings.form.permissionsOnlyMe'),
    },
    {
      key: 'all_team_members',
      text: t('datasetSettings.form.permissionsAllMember'),
    },
  ]

  return (
    <PortalToFollowElem
      open={open}
      onOpenChange={setOpen}
      placement='bottom-start'
      offset={4}
    >
      <div className='relative'>
        <PortalToFollowElemTrigger
          onClick={() => setOpen(v => !v)}
          className='block'
        >
          {permission === 'only_me' && (
            <div className={cn('flex items-center px-3 py-[6px] rounded-lg bg-gray-100 cursor-pointer hover:bg-gray-200', open && 'bg-gray-200')}>
              <Avatar name={userProfile.name} className='shrink-0 mr-2' size={24} />
              <div className='grow mr-2 text-gray-900 text-sm leading-5'>{t('datasetSettings.form.permissionsOnlyMe')}</div>
              <RiArrowDownSLine className='shrink-0 w-4 h-4 text-gray-700' />
            </div>
          )}
          {permission === 'all_team_members' && (
            <div className={cn('flex items-center px-3 py-[6px] rounded-lg bg-gray-100 cursor-pointer hover:bg-gray-200', open && 'bg-gray-200')}>
              <div className='mr-2 flex items-center justify-center w-6 h-6 rounded-lg bg-[#EEF4FF]'>
                <Users01 className='w-3.5 h-3.5 text-[#444CE7]' />
              </div>
              <div className='grow mr-2 text-gray-900 text-sm leading-5'>{t('datasetSettings.form.permissionsAllMember')}</div>
              <RiArrowDownSLine className='shrink-0 w-4 h-4 text-gray-700' />
            </div>
          )}
          {/* TODO */}
          {permission === 'selected_team_members' && (
            <div className={cn('flex items-center px-3 py-[6px] rounded-lg bg-gray-100 cursor-pointer hover:bg-gray-200', open && 'bg-gray-200')}>
              <div className='mr-2 flex items-center justify-center w-6 h-6 rounded-lg bg-[#EEF4FF]'>
                <Users01 className='w-3.5 h-3.5 text-[#444CE7]' />
                <UsersPlus className='w-3.5 h-3.5 text-[#444CE7]' />
              </div>
              <div className='grow mr-2 text-gray-900 text-sm leading-5'>
              </div>
              <RiArrowDownSLine className='shrink-0 w-4 h-4 text-gray-700' />
            </div>
          )}
        </PortalToFollowElemTrigger>
        <PortalToFollowElemContent className='z-[1002]'>
          <div className='relative w-[480px] bg-white rounded-lg border-[0.5px] bg-gray-200 shadow-lg'>
            <div className='p-1'>
              <div className='pl-3 pr-2 py-1 rounded-lg hover:bg-gray-50 cursor-pointer' onClick={() => {
                onChange('only_me')
                setOpen(false)
              }}>
                <div className='flex items-center gap-2'>
                  <Avatar name={userProfile.name} className='shrink-0 mr-2' size={24} />
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
                onChange('selected_team_members')
                // setOpen(false)
              }}>
                <div className='flex items-center gap-2'>
                  <div className={cn('mr-2 flex items-center justify-center w-6 h-6 rounded-lg bg-[#FFF6ED]', permission === 'selected_team_members' && '!bg-[#EEF4FF]')}>
                    <UsersPlus className={cn('w-3.5 h-3.5 text-[#FB6514]', permission === 'selected_team_members' && '!text-[#444CE7]')} />
                  </div>
                  <div className='grow mr-2 text-gray-900 text-sm leading-5'>{t('datasetSettings.form.permissionsInvitedMembers')}</div>
                  {permission === 'selected_team_members' && <Check className='w-4 h-4 text-primary-600' />}
                </div>
              </div>
            </div>
            {permission === 'selected_team_members' && (
              <div className='h-[360px] border-t-[1px] border-gray-100 p-1'>
                {/* TODO */}
              </div>
            )}
          </div>
        </PortalToFollowElemContent>
      </div>
    </PortalToFollowElem>
  )
}

export default PermissionSelector
