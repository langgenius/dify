'use client'
import { useState } from 'react'
import useSWR from 'swr'
import dayjs from 'dayjs'
import 'dayjs/locale/zh-cn'
import relativeTime from 'dayjs/plugin/relativeTime'
import { useContext } from 'use-context-selector'
import { RiUserAddLine } from '@remixicon/react'
import { useTranslation } from 'react-i18next'
import InviteModal from './invite-modal'
import InvitedModal from './invited-modal'
import Operation from './operation'
import { fetchMembers } from '@/service/common'
import I18n from '@/context/i18n'
import { useAppContext } from '@/context/app-context'
import Avatar from '@/app/components/base/avatar'
import type { InvitationResult } from '@/models/common'
import LogoEmbededChatHeader from '@/app/components/base/logo/logo-embeded-chat-header'
import { useProviderContext } from '@/context/provider-context'
import { Plan } from '@/app/components/billing/type'
import UpgradeBtn from '@/app/components/billing/upgrade-btn'
import { NUM_INFINITE } from '@/app/components/billing/config'
import { LanguagesSupported } from '@/i18n/language'
dayjs.extend(relativeTime)

const MembersPage = () => {
  const { t } = useTranslation()
  const RoleMap = {
    owner: t('common.members.owner'),
    admin: t('common.members.admin'),
    editor: t('common.members.editor'),
    normal: t('common.members.normal'),
  }
  const { locale } = useContext(I18n)

  const { userProfile, currentWorkspace, isCurrentWorkspaceManager } = useAppContext()
  const { data, mutate } = useSWR({ url: '/workspaces/current/members' }, fetchMembers)
  const [inviteModalVisible, setInviteModalVisible] = useState(false)
  const [invitationResults, setInvitationResults] = useState<InvitationResult[]>([])
  const [invitedModalVisible, setInvitedModalVisible] = useState(false)
  const accounts = data?.accounts || []
  const owner = accounts.filter(account => account.role === 'owner')?.[0]?.email === userProfile.email
  const { plan, enableBilling } = useProviderContext()
  const isNotUnlimitedMemberPlan = enableBilling && plan.type !== Plan.team && plan.type !== Plan.enterprise
  const isMemberFull = enableBilling && isNotUnlimitedMemberPlan && accounts.length >= plan.total.teamMembers

  return (
    <>
      <div className='flex flex-col'>
        <div className='flex items-center mb-4 p-3 bg-gray-50 rounded-2xl'>
          <LogoEmbededChatHeader className='!w-10 !h-10' />
          <div className='grow mx-2'>
            <div className='text-sm font-medium text-gray-900'>{currentWorkspace?.name}</div>
            {enableBilling && (
              <div className='text-xs text-gray-500'>
                {isNotUnlimitedMemberPlan
                  ? (
                    <div className='flex space-x-1'>
                      <div>{t('billing.plansCommon.member')}{locale !== LanguagesSupported[1] && accounts.length > 1 && 's'}</div>
                      <div className='text-gray-700'>{accounts.length}</div>
                      <div>/</div>
                      <div>{plan.total.teamMembers === NUM_INFINITE ? t('billing.plansCommon.unlimited') : plan.total.teamMembers}</div>
                    </div>
                  )
                  : (
                    <div className='flex space-x-1'>
                      <div>{accounts.length}</div>
                      <div>{t('billing.plansCommon.memberAfter')}{locale !== LanguagesSupported[1] && accounts.length > 1 && 's'}</div>
                    </div>
                  )}
              </div>
            )}

          </div>
          {isMemberFull && (
            <UpgradeBtn className='mr-2' loc='member-invite' />
          )}
          <div className={
            `shrink-0 flex items-center py-[7px] px-3 border-[0.5px] border-gray-200
            text-[13px] font-medium text-primary-600 bg-white
            shadow-xs rounded-lg ${(isCurrentWorkspaceManager && !isMemberFull) ? 'cursor-pointer' : 'grayscale opacity-50 cursor-default'}`
          } onClick={() => (isCurrentWorkspaceManager && !isMemberFull) && setInviteModalVisible(true)}>
            <RiUserAddLine className='w-4 h-4 mr-2 ' />
            {t('common.members.invite')}
          </div>
        </div>
        <div className='overflow-visible lg:overflow-visible'>
          <div className='flex items-center py-[7px] border-b border-gray-200 min-w-[480px]'>
            <div className='grow px-3 text-xs font-medium text-gray-500'>{t('common.members.name')}</div>
            <div className='shrink-0 w-[104px] text-xs font-medium text-gray-500'>{t('common.members.lastActive')}</div>
            <div className='shrink-0 w-[96px] px-3 text-xs font-medium text-gray-500'>{t('common.members.role')}</div>
          </div>
          <div className='min-w-[480px] relative'>
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
                  <div className='shrink-0 flex items-center w-[104px] py-2 text-[13px] text-gray-700'>{dayjs(Number((account.last_active_at || account.created_at)) * 1000).locale(locale === 'zh-Hans' ? 'zh-cn' : 'en').fromNow()}</div>
                  <div className='shrink-0 w-[96px] flex items-center'>
                    {
                      (owner && account.role !== 'owner')
                        ? <Operation member={account} onOperate={mutate} />
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
            onSend={(invitationResults) => {
              setInvitedModalVisible(true)
              setInvitationResults(invitationResults)
              mutate()
            }}
          />
        )
      }
      {
        invitedModalVisible && (
          <InvitedModal
            invitationResults={invitationResults}
            onCancel={() => setInvitedModalVisible(false)}
          />
        )
      }
    </>
  )
}

export default MembersPage
