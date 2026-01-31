'use client'
import type { InvitationResult } from '@/models/common'
import { RiPencilLine } from '@remixicon/react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import Avatar from '@/app/components/base/avatar'
import Tooltip from '@/app/components/base/tooltip'
import { NUM_INFINITE } from '@/app/components/billing/config'
import { Plan } from '@/app/components/billing/type'
import UpgradeBtn from '@/app/components/billing/upgrade-btn'
import { useAppContext } from '@/context/app-context'
import { useGlobalPublicStore } from '@/context/global-public-context'
import { useLocale } from '@/context/i18n'
import { useProviderContext } from '@/context/provider-context'
import { useFormatTimeFromNow } from '@/hooks/use-format-time-from-now'
import { LanguagesSupported } from '@/i18n-config/language'
import { useMembers } from '@/service/use-common'
import EditWorkspaceModal from './edit-workspace-modal'
import InviteButton from './invite-button'
import InviteModal from './invite-modal'
import InvitedModal from './invited-modal'
import Operation from './operation'
import TransferOwnership from './operation/transfer-ownership'
import TransferOwnershipModal from './transfer-ownership-modal'

const MembersPage = () => {
  const { t } = useTranslation()
  const RoleMap = {
    owner: t('members.owner', { ns: 'common' }),
    admin: t('members.admin', { ns: 'common' }),
    editor: t('members.editor', { ns: 'common' }),
    dataset_operator: t('members.datasetOperator', { ns: 'common' }),
    normal: t('members.normal', { ns: 'common' }),
  }
  const locale = useLocale()

  const { userProfile, currentWorkspace, isCurrentWorkspaceOwner, isCurrentWorkspaceManager } = useAppContext()
  const { data, refetch } = useMembers()
  const systemFeatures = useGlobalPublicStore(s => s.systemFeatures)
  const { formatTimeFromNow } = useFormatTimeFromNow()
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
      <div className="flex flex-col">
        <div className="mb-4 flex items-center gap-3 rounded-xl border-l-[0.5px] border-t-[0.5px] border-divider-subtle bg-gradient-to-r from-background-gradient-bg-fill-chat-bg-2 to-background-gradient-bg-fill-chat-bg-1 p-3 pr-5">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-components-icon-bg-blue-solid text-[20px]">
            <span className="bg-gradient-to-r from-components-avatar-shape-fill-stop-0 to-components-avatar-shape-fill-stop-100 bg-clip-text font-semibold uppercase text-shadow-shadow-1 opacity-90">{currentWorkspace?.name[0]?.toLocaleUpperCase()}</span>
          </div>
          <div className="grow">
            <div className="system-md-semibold flex items-center gap-1 text-text-secondary">
              <span>{currentWorkspace?.name}</span>
              {isCurrentWorkspaceOwner && (
                <span>
                  <Tooltip
                    popupContent={t('account.editWorkspaceInfo', { ns: 'common' })}
                  >
                    <div
                      className="cursor-pointer rounded-md p-1 hover:bg-black/5"
                      onClick={() => {
                        setEditWorkspaceModalVisible(true)
                      }}
                    >
                      <RiPencilLine className="h-4 w-4 text-text-tertiary" />
                    </div>
                  </Tooltip>
                </span>
              )}
            </div>
            <div className="system-xs-medium mt-1 text-text-tertiary">
              {enableBilling && isNotUnlimitedMemberPlan
                ? (
                    <div className="flex space-x-1">
                      <div>
                        {t('plansCommon.member', { ns: 'billing' })}
                        {locale !== LanguagesSupported[1] && accounts.length > 1 && 's'}
                      </div>
                      <div className="">{accounts.length}</div>
                      <div>/</div>
                      <div>{plan.total.teamMembers === NUM_INFINITE ? t('plansCommon.unlimited', { ns: 'billing' }) : plan.total.teamMembers}</div>
                    </div>
                  )
                : (
                    <div className="flex space-x-1">
                      <div>{accounts.length}</div>
                      <div>
                        {t('plansCommon.memberAfter', { ns: 'billing' })}
                        {locale !== LanguagesSupported[1] && accounts.length > 1 && 's'}
                      </div>
                    </div>
                  )}
            </div>

          </div>
          {isMemberFull && (
            <UpgradeBtn className="mr-2" loc="member-invite" />
          )}
          <div className="shrink-0">
            <InviteButton disabled={!isCurrentWorkspaceManager || isMemberFull} onClick={() => setInviteModalVisible(true)} />
          </div>
        </div>
        <div className="overflow-visible lg:overflow-visible">
          <div className="flex min-w-[480px] items-center border-b border-divider-regular py-[7px]">
            <div className="system-xs-medium-uppercase grow px-3 text-text-tertiary">{t('members.name', { ns: 'common' })}</div>
            <div className="system-xs-medium-uppercase w-[104px] shrink-0 text-text-tertiary">{t('members.lastActive', { ns: 'common' })}</div>
            <div className="system-xs-medium-uppercase w-[96px] shrink-0 px-3 text-text-tertiary">{t('members.role', { ns: 'common' })}</div>
          </div>
          <div className="relative min-w-[480px]">
            {
              accounts.map(account => (
                <div key={account.id} className="flex border-b border-divider-subtle">
                  <div className="flex grow items-center px-3 py-2">
                    <Avatar avatar={account.avatar_url} size={24} className="mr-2" name={account.name} />
                    <div className="">
                      <div className="system-sm-medium text-text-secondary">
                        {account.name}
                        {account.status === 'pending' && <span className="system-xs-medium ml-1 text-text-warning">{t('members.pending', { ns: 'common' })}</span>}
                        {userProfile.email === account.email && <span className="system-xs-regular text-text-tertiary">{t('members.you', { ns: 'common' })}</span>}
                      </div>
                      <div className="system-xs-regular text-text-tertiary">{account.email}</div>
                    </div>
                  </div>
                  <div className="system-sm-regular flex w-[104px] shrink-0 items-center py-2 text-text-secondary">{formatTimeFromNow(Number((account.last_active_at || account.created_at)) * 1000)}</div>
                  <div className="flex w-[96px] shrink-0 items-center">
                    {isCurrentWorkspaceOwner && account.role === 'owner' && isAllowTransferWorkspace && (
                      <TransferOwnership onOperate={() => setShowTransferOwnershipModal(true)}></TransferOwnership>
                    )}
                    {isCurrentWorkspaceOwner && account.role === 'owner' && !isAllowTransferWorkspace && (
                      <div className="system-sm-regular px-3 text-text-secondary">{RoleMap[account.role] || RoleMap.normal}</div>
                    )}
                    {isCurrentWorkspaceOwner && account.role !== 'owner' && (
                      <Operation member={account} operatorRole={currentWorkspace.role} onOperate={refetch} />
                    )}
                    {!isCurrentWorkspaceOwner && (
                      <div className="system-sm-regular px-3 text-text-secondary">{RoleMap[account.role] || RoleMap.normal}</div>
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
              refetch()
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
