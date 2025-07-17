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
import EditWorkspaceModal from './edit-workspace-modal'
import TransferOwnershipModal from './transfer-ownership-modal'
import Operation from './operation'
import TransferOwnership from './operation/transfer-ownership'
import { fetchMembers } from '@/service/common'
import I18n from '@/context/i18n'
import { useAppContext } from '@/context/app-context'
import Avatar from '@/app/components/base/avatar'
import type { InvitationResult } from '@/models/common'
import { useProviderContext } from '@/context/provider-context'
import { Plan } from '@/app/components/billing/type'
import Button from '@/app/components/base/button'
import UpgradeBtn from '@/app/components/billing/upgrade-btn'
import { NUM_INFINITE } from '@/app/components/billing/config'
import { LanguagesSupported } from '@/i18n/language'
import cn from '@/utils/classnames'
import Tooltip from '@/app/components/base/tooltip'
import { RiPencilLine } from '@remixicon/react'
import { useGlobalPublicStore } from '@/context/global-public-context'
dayjs.extend(relativeTime)

const MembersPage = () => {
  const { t } = useTranslation()
  const RoleMap = {
    owner: t('common.members.owner'),
    admin: t('common.members.admin'),
    editor: t('common.members.editor'),
    dataset_operator: t('common.members.datasetOperator'),
    normal: t('common.members.normal'),
  }
  const { locale } = useContext(I18n)

  const { userProfile, currentWorkspace, isCurrentWorkspaceOwner, isCurrentWorkspaceManager } = useAppContext()
  const { data, mutate } = useSWR(
    {
      url: '/workspaces/current/members',
      params: {},
    },
    fetchMembers,
  )
  const { systemFeatures } = useGlobalPublicStore()
  const [inviteModalVisible, setInviteModalVisible] = useState(false)
  const [invitationResults, setInvitationResults] = useState<InvitationResult[]>([])
  const [invitedModalVisible, setInvitedModalVisible] = useState(false)
  const accounts = data?.accounts || []
  const { plan, enableBilling, isAllowTransferWorkspace } = useProviderContext()
  const isNotUnlimitedMemberPlan = enableBilling && plan.type !== Plan.team && plan.type !== Plan.enterprise
  const isMemberFull = enableBilling && isNotUnlimitedMemberPlan && accounts.length >= plan.total.teamMembers
  const [editWorkspaceModalVisible, setEditWorkspaceModalVisible] = useState(false)
  const [showTransferOwnershipModal, setShowTransferOwnershipModal] = useState(false)

  return (
    <>
      <div className='flex flex-col'>
        <div className='mb-4 flex items-center gap-3 rounded-xl border-l-[0.5px] border-t-[0.5px] border-divider-subtle bg-gradient-to-r from-background-gradient-bg-fill-chat-bg-2 to-background-gradient-bg-fill-chat-bg-1 p-3 pr-5'>
          <div className='flex h-12 w-12 items-center justify-center rounded-xl bg-components-icon-bg-blue-solid text-[20px]'>
            <span className='bg-gradient-to-r from-components-avatar-shape-fill-stop-0 to-components-avatar-shape-fill-stop-100 bg-clip-text font-semibold uppercase text-shadow-shadow-1 opacity-90'>{currentWorkspace?.name[0]?.toLocaleUpperCase()}</span>
          </div>
          <div className='grow'>
            <div className='system-md-semibold flex items-center gap-1 text-text-secondary'>
              <span>{currentWorkspace?.name}</span>
              {isCurrentWorkspaceOwner && <span>
                <Tooltip
                  popupContent={t('common.account.editWorkspaceInfo')}
                >
                  <div
                    className='cursor-pointer rounded-md p-1 hover:bg-black/5'
                    onClick={() => {
                      setEditWorkspaceModalVisible(true)
                    }}
                  >
                    <RiPencilLine className='h-4 w-4 text-text-tertiary' />
                  </div>
                </Tooltip>
              </span>}
            </div>
            <div className='system-xs-medium mt-1 text-text-tertiary'>
              {enableBilling && isNotUnlimitedMemberPlan
                ? (
                  <div className='flex space-x-1'>
                    <div>{t('billing.plansCommon.member')}{locale !== LanguagesSupported[1] && accounts.length > 1 && 's'}</div>
                    <div className=''>{accounts.length}</div>
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

          </div>
          {isMemberFull && (
            <UpgradeBtn className='mr-2' loc='member-invite' />
          )}
          <Button variant='primary' className={cn('shrink-0')} disabled={!isCurrentWorkspaceManager || isMemberFull} onClick={() => setInviteModalVisible(true)}>
            <RiUserAddLine className='mr-1 h-4 w-4' />
            {t('common.members.invite')}
          </Button>
        </div>
        <div className='overflow-visible lg:overflow-visible'>
          <div className='flex min-w-[480px] items-center border-b border-divider-regular py-[7px]'>
            <div className='system-xs-medium-uppercase grow px-3 text-text-tertiary'>{t('common.members.name')}</div>
            <div className='system-xs-medium-uppercase w-[104px] shrink-0 text-text-tertiary'>{t('common.members.lastActive')}</div>
            <div className='system-xs-medium-uppercase w-[96px] shrink-0 px-3 text-text-tertiary'>{t('common.members.role')}</div>
          </div>
          <div className='relative min-w-[480px]'>
            {
              accounts.map(account => (
                <div key={account.id} className='flex border-b border-divider-subtle'>
                  <div className='flex grow items-center px-3 py-2'>
                    <Avatar avatar={account.avatar_url} size={24} className='mr-2' name={account.name} />
                    <div className=''>
                      <div className='system-sm-medium text-text-secondary'>
                        {account.name}
                        {account.status === 'pending' && <span className='system-xs-medium ml-1 text-text-warning'>{t('common.members.pending')}</span>}
                        {userProfile.email === account.email && <span className='system-xs-regular text-text-tertiary'>{t('common.members.you')}</span>}
                      </div>
                      <div className='system-xs-regular text-text-tertiary'>{account.email}</div>
                    </div>
                  </div>
                  <div className='system-sm-regular flex w-[104px] shrink-0 items-center py-2 text-text-secondary'>{dayjs(Number((account.last_active_at || account.created_at)) * 1000).locale(locale === 'zh-Hans' ? 'zh-cn' : 'en').fromNow()}</div>
                  <div className='flex w-[96px] shrink-0 items-center'>
                    {isCurrentWorkspaceOwner && account.role === 'owner' && isAllowTransferWorkspace && (
                      <TransferOwnership onOperate={() => setShowTransferOwnershipModal(true)}></TransferOwnership>
                    )}
                    {isCurrentWorkspaceOwner && account.role === 'owner' && !isAllowTransferWorkspace && (
                      <div className='system-sm-regular px-3 text-text-secondary'>{RoleMap[account.role] || RoleMap.normal}</div>
                    )}
                    {isCurrentWorkspaceOwner && account.role !== 'owner' && (
                      <Operation member={account} operatorRole={currentWorkspace.role} onOperate={mutate} />
                    )}
                    {!isCurrentWorkspaceOwner && (
                      <div className='system-sm-regular px-3 text-text-secondary'>{RoleMap[account.role] || RoleMap.normal}</div>
                    )}
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
            isEmailSetup={systemFeatures.is_email_setup}
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
      {
        editWorkspaceModalVisible && (
          <EditWorkspaceModal
            onCancel={() => setEditWorkspaceModalVisible(false)}
          />
        )
      }
      {showTransferOwnershipModal && (
        <TransferOwnershipModal
          show={showTransferOwnershipModal}
          onClose={() => setShowTransferOwnershipModal(false)}
        />
      )}
    </>
  )
}

export default MembersPage
