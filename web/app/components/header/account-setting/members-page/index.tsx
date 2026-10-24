'use client'
import type {
  AccountWithRoleResponse,
  MemberInviteResponse,
} from '@dify/contracts/api/console/workspaces/types.gen'
import type { RemoveMemberPayload } from './remove-member-content'
import {
  AlertDialog,
  AlertDialogContent,
  createAlertDialogHandle,
} from '@langgenius/dify-ui/alert-dialog'
import {
  createDialogHandle,
  Dialog,
  DialogContent,
  DialogTrigger,
} from '@langgenius/dify-ui/dialog'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@langgenius/dify-ui/tooltip'
import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { useAtomValue } from 'jotai'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocale } from '#i18n'
import { WorkspaceAvatar } from '@/app/components/base/workspace-avatar'
import UpgradeBtn from '@/app/components/billing/upgrade-btn'
import { workspacePermissionKeysAtom } from '@/context/permission-state'
import { currentWorkspaceAtom, isCurrentWorkspaceOwnerAtom } from '@/context/workspace-state'
import { userProfileQueryOptions } from '@/features/account-profile/client'
import { systemFeaturesQueryOptions } from '@/features/system-features/client'
import { getAccessControlTemplateLanguage, LanguagesSupported } from '@/i18n/language'
import { consoleQuery } from '@/service/console'
import { hasPermission } from '@/utils/permission'
import EditWorkspaceContent from './edit-workspace-content'
import InvitationResultsContent from './invitation-results-content'
import { InviteModal } from './invite-modal'
import MemberDetailsContent from './member-details-content'
import MemberRow from './member-row'
import RemoveMemberContent from './remove-member-content'
import { useUpdateMemberRoles } from './use-update-member-roles'

const MembersPage = () => {
  const { t } = useTranslation([
    'billing',
    'common',
    'workspaceMembers',
    'accountSettings',
    'permission',
  ])
  const locale = useLocale()
  const language = getAccessControlTemplateLanguage(locale)

  const { data: userProfileEmail } = useSuspenseQuery({
    ...userProfileQueryOptions(),
    select: (data) => data.profile.email,
  })
  const currentWorkspace = useAtomValue(currentWorkspaceAtom)
  const isCurrentWorkspaceOwner = useAtomValue(isCurrentWorkspaceOwnerAtom)
  const workspacePermissionKeys = useAtomValue(workspacePermissionKeysAtom)
  const { data } = useQuery(
    consoleQuery.workspaces.current.members.get.queryOptions({ input: { query: { language } } }),
  )
  const { data: systemFeatures } = useSuspenseQuery(systemFeaturesQueryOptions())
  const [invitationDialogHandle] = useState(() =>
    createDialogHandle<MemberInviteResponse['invitation_results']>(),
  )
  const workspaceNameInputRef = useRef<HTMLInputElement>(null)
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
  const [detailsDialogHandle] = useState(() => createDialogHandle<AccountWithRoleResponse>())

  const canManageMembers = hasPermission(workspacePermissionKeys, 'workspace.member.manage')
  const roleColumnLabel = systemFeatures.rbac_enabled
    ? t(($) => $['members.roles'], { ns: 'workspaceMembers' })
    : t(($) => $['members.role'], { ns: 'workspaceMembers' })

  const { submitAsync: updateRolesOfMember, isPending: isSavingMember } = useUpdateMemberRoles(
    systemFeatures.rbac_enabled,
    () => detailsDialogHandle.close(),
  )
  const [removeDialogHandle] = useState(() => createAlertDialogHandle<RemoveMemberPayload>())
  const removeReturnFocusRef = useRef<HTMLButtonElement>(null)
  const listRef = useRef<HTMLTableElement>(null)
  const queryClient = useQueryClient()
  const removal = useMutation(
    consoleQuery.workspaces.current.members.byMemberId.delete.mutationOptions({
      context: { silent: true },
      onSuccess: () => {
        void queryClient.invalidateQueries({
          queryKey: consoleQuery.workspaces.current.members.get.key(),
        })
        removeDialogHandle.close()
      },
    }),
  )

  return (
    <Dialog
      handle={detailsDialogHandle}
      onOpenChange={(open, details) => {
        if (!open && isSavingMember && details.reason !== 'imperative-action') details.cancel()
      }}
    >
      {({ payload: member }) => (
        <>
          <div className="flex flex-col">
            <div className="mb-6 flex flex-wrap items-center gap-3 rounded-xl border-s-[0.5px] border-t-[0.5px] border-divider-subtle bg-linear-to-r from-background-gradient-bg-fill-chat-bg-2 to-background-gradient-bg-fill-chat-bg-1 py-2 ps-2 pe-5 rtl:bg-linear-to-l">
              <div className="flex min-w-0 grow basis-48 items-center gap-3">
                <WorkspaceAvatar name={currentWorkspace.name} size="2xl" className="shrink-0" />
                <div className="min-w-0 grow">
                  <div className="flex items-center gap-1 system-md-semibold text-text-secondary">
                    <span className="min-w-0 wrap-anywhere">{currentWorkspace?.name}</span>
                    {isCurrentWorkspaceOwner && (
                      <span className="shrink-0">
                        <Dialog>
                          <Tooltip>
                            <TooltipTrigger
                              render={
                                <DialogTrigger
                                  render={
                                    <IconButton
                                      aria-label={t(($) => $['account.editWorkspaceInfo'], {
                                        ns: 'accountSettings',
                                      })}
                                    >
                                      <span
                                        aria-hidden
                                        className="i-ri-pencil-line size-4 text-text-tertiary"
                                      />
                                    </IconButton>
                                  }
                                />
                              }
                            />
                            <TooltipContent>
                              {t(($) => $['account.editWorkspaceInfo'], { ns: 'accountSettings' })}
                            </TooltipContent>
                          </Tooltip>
                          <DialogContent
                            initialFocus={workspaceNameInputRef}
                            backdropProps={{ forceRender: true }}
                          >
                            <EditWorkspaceContent inputRef={workspaceNameInputRef} />
                          </DialogContent>
                        </Dialog>
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
                        <div className="flex gap-x-1">
                          <span>{accounts.length}</span>
                          <span>/</span>
                          <span>
                            {features.members.limit === 0
                              ? t(($) => $['plansCommon.unlimited'], { ns: 'billing' })
                              : features.members.limit}
                          </span>
                        </div>
                      </div>
                    ) : (
                      <div className="flex gap-x-1">
                        <div className="shrink-0">{accounts.length}</div>
                        <div>
                          {t(($) => $['plansCommon.memberAfter'], { ns: 'billing' })}
                          {locale !== LanguagesSupported[1] && accounts.length > 1 && 's'}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                {isMemberFull && <UpgradeBtn className="shrink-0" loc="member-invite" />}
                {canManageMembers && (
                  <div className="shrink-0">
                    <InviteModal
                      isEmailSetup={systemFeatures.is_email_setup}
                      onSend={(results) => invitationDialogHandle.openWithPayload(results)}
                    />
                  </div>
                )}
              </div>
            </div>
            <div className="overflow-x-auto">
              <table
                ref={listRef}
                tabIndex={-1}
                className="w-full min-w-150 table-fixed text-start"
              >
                <colgroup>
                  <col className="w-65" />
                  <col className="w-30" />
                  <col />
                  {canManageMembers && <col className="w-12" />}
                </colgroup>
                <thead>
                  <tr className="border-b border-divider-regular">
                    <th className="px-3 py-1.75 text-start system-xs-medium-uppercase text-text-tertiary">
                      {t(($) => $['members.name'], { ns: 'workspaceMembers' })}
                    </th>
                    <th className="py-1.75 text-start system-xs-medium-uppercase text-text-tertiary">
                      {t(($) => $['members.lastActive'], { ns: 'workspaceMembers' })}
                    </th>
                    <th className="px-3 py-1.75 text-start system-xs-medium-uppercase text-text-tertiary">
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
                      removeDialogHandle={removeDialogHandle}
                      removeReturnFocusRef={removeReturnFocusRef}
                      roles={account.roles ?? []}
                      isCurrentUser={userProfileEmail === account.email}
                      canManage={canManageMembers}
                      canTransferOwnership={
                        isCurrentWorkspaceOwner && features?.is_allow_transfer_workspace === true
                      }
                      allowMultipleRoles={systemFeatures.rbac_enabled}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <AlertDialog
            handle={removeDialogHandle}
            onOpenChange={(open, details) => {
              if (!open && removal.isPending && details.reason !== 'imperative-action')
                details.cancel()
            }}
            onOpenChangeComplete={(open) => {
              if (!open) removal.reset()
            }}
          >
            {({ payload }) => (
              <AlertDialogContent
                finalFocus={() =>
                  removeReturnFocusRef.current?.isConnected
                    ? removeReturnFocusRef.current
                    : listRef.current
                }
                backdropProps={{ forceRender: true }}
              >
                {payload && (
                  <RemoveMemberContent
                    name={payload.name || payload.email}
                    isPending={removal.isPending}
                    error={
                      removal.isError
                        ? t(($) => $['api.actionFailed'], { ns: 'common' })
                        : undefined
                    }
                    onSubmit={() => {
                      if (!removal.isPending) removal.mutate({ params: { member_id: payload.id } })
                    }}
                  />
                )}
              </AlertDialogContent>
            )}
          </AlertDialog>
          <Dialog handle={invitationDialogHandle}>
            {({ payload: results }) => (
              <DialogContent backdropProps={{ forceRender: true }}>
                {results && <InvitationResultsContent invitationResults={results} />}
              </DialogContent>
            )}
          </Dialog>
          <DialogContent className="w-110" backdropProps={{ forceRender: true }}>
            {member && (
              <MemberDetailsContent
                key={member.id}
                member={member}
                canAssignRoles={
                  canManageMembers && member.role !== 'owner' && userProfileEmail !== member.email
                }
                allowMultipleRoles={systemFeatures.rbac_enabled}
                onClose={() => detailsDialogHandle.close()}
                onAssignSubmit={(roles) => updateRolesOfMember(member.id, roles)}
              />
            )}
          </DialogContent>
        </>
      )}
    </Dialog>
  )
}

export default MembersPage
