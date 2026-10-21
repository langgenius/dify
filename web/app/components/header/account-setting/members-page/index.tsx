'use client'
import type {
  AccountWithRoleResponse,
  MemberInviteResponse,
} from '@dify/contracts/api/console/workspaces/types.gen'
import type { Role } from '@/models/access-control'
import { Tooltip, TooltipContent, TooltipTrigger } from '@langgenius/dify-ui/tooltip'
import { useMutation, useQuery, useSuspenseQuery } from '@tanstack/react-query'
import { useAtomValue } from 'jotai'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocale } from '#i18n'
import { WorkspaceAvatar } from '@/app/components/base/workspace-avatar'
import UpgradeBtn from '@/app/components/billing/upgrade-btn'
import { toast } from '@/app/notifications'
import { workspacePermissionKeysAtom } from '@/context/permission-state'
import { currentWorkspaceAtom, isCurrentWorkspaceOwnerAtom } from '@/context/workspace-state'
import { userProfileQueryOptions } from '@/features/account-profile/client'
import { systemFeaturesQueryOptions } from '@/features/system-features/client'
import { getAccessControlTemplateLanguage, LanguagesSupported } from '@/i18n/language'
import { consoleQuery } from '@/service/console'
import { hasPermission } from '@/utils/permission'
import EditWorkspaceModal from './edit-workspace-modal'
import { InviteModal } from './invite-modal'
import InvitedModal from './invited-modal'
import MemberDetailsModal from './member-details-modal'
import MemberRow from './member-row'
import TransferOwnershipModal from './transfer-ownership-modal'

const MembersPage = () => {
  const { t } = useTranslation(['billing', 'common', 'workspaceMembers', 'accountSettings'])
  const locale = useLocale()
  const language = getAccessControlTemplateLanguage(locale)

  const { data: userProfileEmail } = useSuspenseQuery({
    ...userProfileQueryOptions(),
    select: (data) => data.profile.email,
  })
  const currentWorkspace = useAtomValue(currentWorkspaceAtom)
  const isCurrentWorkspaceOwner = useAtomValue(isCurrentWorkspaceOwnerAtom)
  const workspacePermissionKeys = useAtomValue(workspacePermissionKeysAtom)
  const { data, refetch } = useQuery(
    consoleQuery.workspaces.current.members.get.queryOptions({ input: { query: { language } } }),
  )
  const { data: systemFeatures } = useSuspenseQuery(systemFeaturesQueryOptions())
  const [invitationResults, setInvitationResults] = useState<
    MemberInviteResponse['invitation_results'] | null
  >(null)
  const accounts = data?.accounts || []
  const deploymentEdition = systemFeatures.deployment_edition
  const { data: features } = useQuery(
    consoleQuery.features.get.queryOptions({
      select: (data) => ({
        plan: data.billing.subscription.plan,
        members: data.members,
        is_allow_transfer_workspace: data.is_allow_transfer_workspace,
      }),
    }),
  )

  const isNotUnlimitedMemberPlan =
    deploymentEdition === 'CLOUD' && features !== undefined && features.plan !== 'team'
  // A limit of 0 means unlimited.
  const isMemberFull =
    isNotUnlimitedMemberPlan &&
    features.members.limit > 0 &&
    accounts.length >= features.members.limit
  const [editWorkspaceModalVisible, setEditWorkspaceModalVisible] = useState(false)
  const [showTransferOwnershipModal, setShowTransferOwnershipModal] = useState(false)
  const [detailsMember, setDetailsMember] = useState<AccountWithRoleResponse | null>(null)

  const canManageMembers = hasPermission(workspacePermissionKeys, 'workspace.member.manage')
  const roleColumnLabel = systemFeatures.rbac_enabled
    ? t(($) => $['members.roles'], { ns: 'workspaceMembers' })
    : t(($) => $['members.role'], { ns: 'workspaceMembers' })

  const handleOpenDetails = useCallback((member: AccountWithRoleResponse) => {
    setDetailsMember(member)
  }, [])

  const handleCloseDetails = useCallback(() => {
    setDetailsMember(null)
  }, [])

  const { mutateAsync: updateRolesOfMember } = useMutation(
    consoleQuery.workspaces.current.rbac.members.byMemberId.rbacRoles.put.mutationOptions(),
  )

  const handleAssignRolesSubmit = (roles: Role[]) => {
    const roleIds = systemFeatures.rbac_enabled
      ? roles.map((role) => role.id)
      : roles.slice(0, 1).map((role) => role.id)

    return updateRolesOfMember(
      { params: { member_id: detailsMember!.id }, body: { role_ids: roleIds } },
      {
        onSuccess: async () => {
          toast.success(t(($) => $['actionMsg.modifiedSuccessfully'], { ns: 'common' }))
          await refetch()
        },
      },
    )
  }

  const handleTransferOwnership = useCallback(() => {
    setShowTransferOwnershipModal(true)
  }, [])

  return (
    <>
      <div className="flex flex-col">
        <div className="mb-6 grid grid-cols-[auto_minmax(0,1fr)] items-center gap-3 rounded-xl border-t-[0.5px] border-l-[0.5px] border-divider-subtle bg-linear-to-r from-background-gradient-bg-fill-chat-bg-2 to-background-gradient-bg-fill-chat-bg-1 py-2 pr-5 pl-2 sm:flex">
          <WorkspaceAvatar name={currentWorkspace.name} size="2xl" className="shrink-0" />
          <div className="min-w-0 grow">
            <div className="flex items-center gap-1 system-md-semibold text-text-secondary">
              <span className="min-w-0 wrap-anywhere">{currentWorkspace?.name}</span>
              {isCurrentWorkspaceOwner && (
                <span className="shrink-0">
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <button
                          type="button"
                          aria-label={t(($) => $['account.editWorkspaceInfo'], {
                            ns: 'accountSettings',
                          })}
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
                      }
                    />
                    <TooltipContent>
                      {t(($) => $['account.editWorkspaceInfo'], { ns: 'accountSettings' })}
                    </TooltipContent>
                  </Tooltip>
                </span>
              )}
            </div>
            <div className="mt-1 system-xs-medium text-text-tertiary">
              {isNotUnlimitedMemberPlan ? (
                <div className="flex flex-wrap gap-x-1">
                  <div>
                    {t(($) => $['plansCommon.member'], { ns: 'billing' })}
                    {locale !== LanguagesSupported[1] && accounts.length > 1 && 's'}
                  </div>
                  <div className="">{accounts.length}</div>
                  <div>/</div>
                  <div>
                    {features.members.limit === 0
                      ? t(($) => $['plansCommon.unlimited'], { ns: 'billing' })
                      : features.members.limit}
                  </div>
                </div>
              ) : (
                <div className="flex flex-wrap gap-x-1">
                  <div>{accounts.length}</div>
                  <div>
                    {t(($) => $['plansCommon.memberAfter'], { ns: 'billing' })}
                    {locale !== LanguagesSupported[1] && accounts.length > 1 && 's'}
                  </div>
                </div>
              )}
            </div>
          </div>
          {isMemberFull && (
            <UpgradeBtn className="col-span-2 justify-self-start sm:mr-2" loc="member-invite" />
          )}
          <div className="col-span-2 shrink-0">
            {canManageMembers && (
              <InviteModal
                isEmailSetup={systemFeatures.is_email_setup}
                onSend={setInvitationResults}
              />
            )}
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-150 table-fixed text-left">
            <colgroup>
              <col className="w-65" />
              <col className="w-30" />
              <col />
              {canManageMembers && <col className="w-12" />}
            </colgroup>
            <thead>
              <tr className="border-b border-divider-regular">
                <th className="px-3 py-1.75 text-left system-xs-medium-uppercase text-text-tertiary">
                  {t(($) => $['members.name'], { ns: 'workspaceMembers' })}
                </th>
                <th className="py-1.75 text-left system-xs-medium-uppercase text-text-tertiary">
                  {t(($) => $['members.lastActive'], { ns: 'workspaceMembers' })}
                </th>
                <th className="px-3 py-1.75 text-left system-xs-medium-uppercase text-text-tertiary">
                  {roleColumnLabel}
                </th>
                {canManageMembers && <td />}
              </tr>
            </thead>
            <tbody>
              {accounts.map((account) => (
                <MemberRow
                  key={account.id}
                  member={account}
                  roles={account.roles ?? []}
                  isCurrentUser={userProfileEmail === account.email}
                  canManage={canManageMembers}
                  canTransferOwnership={
                    isCurrentWorkspaceOwner && features?.is_allow_transfer_workspace === true
                  }
                  allowMultipleRoles={systemFeatures.rbac_enabled}
                  onOpenDetails={handleOpenDetails}
                  onTransferOwnership={handleTransferOwnership}
                />
              ))}
            </tbody>
          </table>
        </div>
      </div>
      {invitationResults && (
        <InvitedModal
          invitationResults={invitationResults}
          onCancel={() => setInvitationResults(null)}
        />
      )}
      {editWorkspaceModalVisible && (
        <EditWorkspaceModal onCancel={() => setEditWorkspaceModalVisible(false)} />
      )}
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
            canManageMembers &&
            detailsMember.role !== 'owner' &&
            userProfileEmail !== detailsMember.email
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
