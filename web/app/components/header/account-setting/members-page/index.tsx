'use client'
import { useState } from 'react'
import s from './index.module.css'
import cn from 'classnames'
import useSWR from 'swr'
import dayjs from 'dayjs'
import 'dayjs/locale/zh-cn'
import relativeTime from 'dayjs/plugin/relativeTime'
import I18n from '@/context/i18n'
import { useContext } from 'use-context-selector'
import { fetchMembers } from '@/service/common'
import { UserPlusIcon } from '@heroicons/react/24/outline'
import { useTranslation } from 'react-i18next'
import InviteModal from './invite-modal'
import InvitedModal from './invited-modal'
import Operation from './operation'
import { useAppContext } from '@/context/app-context'
import Avatar from '@/app/components/base/avatar'
import { useWorkspacesContext } from '@/context/workspace-context'

dayjs.extend(relativeTime)
const MembersPage = () => {
  const { t } = useTranslation()
  const RoleMap = {
    owner: t('common.members.owner'),
    admin: t('common.members.admin'),
    normal: t('common.members.normal'),
  }
  const { locale } = useContext(I18n)
  const { userProfile } = useAppContext()
  const { data, mutate } = useSWR({ url: '/workspaces/current/members' }, fetchMembers)
  const [inviteModalVisible, setInviteModalVisible] = useState(false)
  const [invitedModalVisible, setInvitedModalVisible] = useState(false)
  const accounts = data?.accounts || []
  const owner = accounts.filter(account => account.role === 'owner')?.[0]?.email === userProfile.email
  const { workspaces } = useWorkspacesContext()
  const currentWrokspace = workspaces.filter(item => item.current)?.[0]
  
  return (
    <>
      <div>
        <div className='flex items-center mb-4 p-3 bg-gray-50 rounded-2xl'>
          <div className={cn(s['logo-icon'], 'shrink-0')}></div>
          <div className='grow mx-2'>
            <div className='text-sm font-medium text-gray-900'>{currentWrokspace.name}</div>
            <div className='text-xs text-gray-500'>{t('common.userProfile.workspace')}</div>
          </div>
          <div className='
            shrink-0 flex items-center py-[7px] px-3 border-[0.5px] border-gray-200 
            text-[13px] font-medium text-primary-600 bg-white
            shadow-[0_1px_2px_rgba(16,24,40,0.05)] rounded-lg cursor-pointer
          ' onClick={() => setInviteModalVisible(true)}>
            <UserPlusIcon className='w-4 h-4 mr-2 ' />
            {t('common.members.invite')}
          </div>
        </div>
        <div>
          <div className='flex items-center py-[7px] border-b border-gray-200'>
            <div className='grow px-3 text-xs font-medium text-gray-500'>{t('common.members.name')}</div>
            <div className='shrink-0 w-[104px] text-xs font-medium text-gray-500'>{t('common.members.lastActive')}</div>
            <div className='shrink-0 w-[96px] px-3 text-xs font-medium text-gray-500'>{t('common.members.role')}</div>
          </div>
          <div>
            {
              accounts.map(account => (
                <div key={account.id} className='flex border-b border-gray-100'>
                  <div className='grow flex items-center py-2 px-3'>
                    <Avatar size={24} className='mr-2' name={account.name} />
                    <div className=''>
                      <div className='text-[13px] font-medium text-gray-700 leading-[18px]'>
                        {account.name}
                        {account.status === 'pending' && <span className='ml-1 text-xs text-[#DC6803]'>{t('common.members.pending')}</span>}
                        {userProfile.email === account.email && <span className='text-xs text-gray-500'>{t('common.members.you')}</span>}
                      </div>
                      <div className='text-xs text-gray-500 leading-[18px]'>{account.email}</div>
                    </div>
                  </div>
                  <div className='shrink-0 flex items-center w-[104px] py-2 text-[13px] text-gray-700'>{dayjs(Number((account.last_login_at || account.created_at)) * 1000).locale(locale === 'zh-Hans' ? 'zh-cn' : 'en').fromNow()}</div>
                  <div className='shrink-0 w-[96px] flex items-center'>
                    {
                      owner && account.role !== 'owner'
                        ? <Operation member={account} onOperate={() => mutate()} />
                        : <div className='px-3 text-[13px] text-gray-700'>{RoleMap[account.role] || RoleMap.normal}</div>
                    } 
                  </div>
                </div>
              ))
            }
          </div>
        </div>
      </div>
      {
        inviteModalVisible && (
          <InviteModal
            onCancel={() => setInviteModalVisible(false)}
            onSend={() => {
              setInvitedModalVisible(true)
              mutate()
            }}
          />
        )
      }
      {
        invitedModalVisible && (
          <InvitedModal
            onCancel={() => setInvitedModalVisible(false)}
          />
        )
      }
    </>
  )
}

export default MembersPage