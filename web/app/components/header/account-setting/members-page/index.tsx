'use client'
import type { Role } from '@/models/access-control'
import type { InvitationResult, Member } from '@/models/common'
import { toast } from '@langgenius/dify-ui/toast'
import { Tooltip, TooltipContent, TooltipTrigger } from '@langgenius/dify-ui/tooltip'
import { useSuspenseQuery } from '@tanstack/react-query'
import { useCallback, useState } from 'react'
import { useTranslation } from '#i18n'
import { NUM_INFINITE } from '@/app/components/billing/config'
import { Plan } from '@/app/components/billing/type'
import UpgradeBtn from '@/app/components/billing/upgrade-btn'
import { useAppContext } from '@/context/app-context'
import { useLocale } from '@/context/i18n'
import { useProviderContext } from '@/context/provider-context'
import { systemFeaturesQueryOptions } from '@/features/system-features/client'
import { getAccessControlTemplateLanguage, LanguagesSupported } from '@/i18n-config/language'
import { useUpdateRolesOfMember } from '@/service/access-control/use-member-roles'
import { useMembers } from '@/service/use-common'
import { hasPermission } from '@/utils/permission'
import EditWorkspaceModal from './edit-workspace-modal'
import InviteButton from './invite-button'
import InviteModal from './invite-modal'
import InvitedModal from './invited-modal'
import MemberDetailsModal from './member-details-modal'
import MemberRow from './member-row'
import TransferOwnershipModal from './transfer-ownership-modal'

const MembersPage = () => {
  const { t } = useTranslation()
  const locale = useLocale()
  const language = getAccessControlTemplateLanguage(locale)

  const { userProfile, currentWorkspace, isCurrentWorkspaceOwner, workspacePermissionKeys } = useAppContext()
  const { data, refetch } = useMembers(language)
  const { data: systemFeatures } = useSuspenseQuery(systemFeaturesQueryOptions())
  const [inviteModalVisible, setInviteModalVisible] = useState(false)
  const [invitationResults, setInvitationResults] = useState<InvitationResult[]>([])
  const [invitedModalVisible, setInvitedModalVisible] = useState(false)
  const accounts = data?.accounts || []
  const { plan, enableBilling, isAllowTransferWorkspace } = useProviderContext()
  const isNotUnlimitedMemberPlan = enableBilling && plan.type !== Plan.team && plan.type !== Plan.enterprise
  const isMemberFull = enableBilling && isNotUnlimitedMemberPlan && accounts.length >= plan.total.teamMembers
  const [editWorkspaceModalVisible, setEditWorkspaceModalVisible] = useState(false)
  const [showTransferOwnershipModal, setShowTransferOwnershipModal] = useState(false)
  const [detailsMember, setDetailsMember] = useState<Member | null>(null)

  const canManageMembers = hasPermission(workspacePermissionKeys, 'workspace.member.manage')
  const roleColumnLabel = systemFeatures.rbac_enabled
    ? t('members.roles', { ns: 'common' })
    : t('members.role', { ns: 'common' })

  const handleOpenDetails = useCallback((member: Member) => {
    setDetailsMember(member)
  }, [])

  const handleCloseDetails = useCallback(() => {
    setDetailsMember(null)
  }, [])

  const { mutateAsync: updateRolesOfMember } = useUpdateRolesOfMember()

  const handleAssignRolesSubmit = (roles: Role[]) => {
    const roleIds = systemFeatures.rbac_enabled
      ? roles.map(role => role.id)
      : roles.slice(0, 1).map(role => role.id)

    updateRolesOfMember({
      memberId: detailsMember!.id,
      roleIds,
    }, {
      onSuccess: () => {
        toast.success(t('actionMsg.modifiedSuccessfully', { ns: 'common' }))
        refetch()
      },
    })
  }

  const handleTransferOwnership = useCallback(() => {
    setShowTransferOwnershipModal(true)
  }, [])

  return (
    <>
      <div className="flex flex-col">
        <div className="mb-6 flex items-center gap-3 rounded-xl border-t-[0.5px] border-l-[0.5px] border-divider-subtle bg-linear-to-r from-background-gradient-bg-fill-chat-bg-2 to-background-gradient-bg-fill-chat-bg-1 py-2 pr-5 pl-2">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-components-icon-bg-blue-solid text-[20px]">
            <span className="bg-linear-to-r from-components-avatar-shape-fill-stop-0 to-components-avatar-shape-fill-stop-100 bg-clip-text font-semibold text-shadow-shadow-1 uppercase opacity-90">
              {currentWorkspace?.name[0]?.toLocaleUpperCase()}
            </span>
          </div>
          <div className="grow">
            <div className="flex items-center gap-1 system-md-semibold text-text-secondary">
              <span>{currentWorkspace?.name}</span>
              {isCurrentWorkspaceOwner && (
                <span>
                  <Tooltip>
                    <TooltipTrigger
                      render={(
                        <button
                          type="button"
                          aria-label={t('account.editWorkspaceInfo', { ns: 'common' })}
                          className="cursor-pointer rounded-md border-none bg-transparent p-1 hover:bg-black/5"
                          onClick={() => {
                            setEditWorkspaceModalVisible(true)
                          }}
                        >
                          <span
                            aria-hidden="true"
                            className="i-ri-pencil-line size-4 text-text-tertiary"
                          />
                        </button>
                      )}
                    />
                    <TooltipContent>
                      {t('account.editWorkspaceInfo', { ns: 'common' })}
                    </TooltipContent>
                  </Tooltip>
                </span>
              )}
            </div>
            <div className="mt-1 system-xs-medium text-text-tertiary">
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
            {canManageMembers && <InviteButton disabled={isMemberFull} onClick={() => setInviteModalVisible(true)} />}
          </div>
        </div>
        <div className="overflow-visible lg:overflow-visible">
          <div className="flex min-w-120 items-center border-b border-divider-regular py-1.75">
            <div className="w-65 shrink-0 px-3 system-xs-medium-uppercase text-text-tertiary">{t('members.name', { ns: 'common' })}</div>
            <div className="w-30 shrink-0 system-xs-medium-uppercase text-text-tertiary">{t('members.lastActive', { ns: 'common' })}</div>
            <div className="min-w-0 grow px-3 system-xs-medium-uppercase text-text-tertiary">{roleColumnLabel}</div>
          </div>
          <div className="relative min-w-120">
            {accounts.map(account => (
              <MemberRow
                key={account.id}
                member={account}
                roles={account.roles}
                isCurrentUser={userProfile.email === account.email}
                canManage={canManageMembers}
                canTransferOwnership={isCurrentWorkspaceOwner && isAllowTransferWorkspace}
                allowMultipleRoles={systemFeatures.rbac_enabled}
                onOpenDetails={handleOpenDetails}
                onTransferOwnership={handleTransferOwnership}
              />
            ))}
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
      {detailsMember && (
        <MemberDetailsModal
          member={detailsMember}
          canAssignRoles={
            canManageMembers
            && detailsMember.role !== 'owner'
            && userProfile.email !== detailsMember.email
          }
          allowMultipleRoles={systemFeatures.rbac_enabled}
          onClose={handleCloseDetails}
          onAssignSubmit={handleAssignRolesSubmit}
        />
      )}
    </>
  )
}

export default MembersPage
