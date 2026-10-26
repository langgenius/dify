'use client'
import type {
  AccountWithRoleResponse,
  MemberInviteResponse,
} from '@dify/contracts/api/console/workspaces/types.gen'
import type { Role } from '@/models/access-control'
import {
  AlertDialog,
  AlertDialogCancelButton,
  AlertDialogConfirmButton,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
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
import { useMutation, useQuery, useSuspenseQuery } from '@tanstack/react-query'
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
import { getAdjacentFocusTargets } from '@/utils/get-adjacent-focus-targets'
import { hasPermission } from '@/utils/permission'
import EditWorkspaceContent from './edit-workspace-content'
import InvitationResultsContent from './invitation-results-content'
import { InviteModal } from './invite-modal'
import MemberDetailsContent from './member-details-content'
import MemberRow from './member-row'

const MembersPage = () => {
  const { t } = useTranslation([
    'billing',
    'common',
    'workspaceMembers',
    'accountSettings',
    'permission',
    'navigation',
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
  const listRef = useRef<HTMLDivElement>(null)
  const [removeDialog] = useState(() =>
    createAlertDialogHandle<{
      member: AccountWithRoleResponse
      adjacentFocusTargets: HTMLElement[]
      fallbackFocus: { current: HTMLElement | null }
    }>(),
  )
  const removal = useMutation(
    consoleQuery.workspaces.current.members.byMemberId.delete.mutationOptions({
      context: { silent: true },
    }),
  )
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

  const { mutateAsync: updateRolesOfMember, isPending: isSavingMember } = useMutation(
    consoleQuery.workspaces.current.rbac.members.byMemberId.rbacRoles.put.mutationOptions({
      context: { silent: true },
    }),
  )

  const handleAssignRolesSubmit = (member: AccountWithRoleResponse, roles: Role[]) => {
    const roleIds = systemFeatures.rbac_enabled
      ? roles.map((role) => role.id)
      : roles.slice(0, 1).map((role) => role.id)

    return updateRolesOfMember({
      params: { member_id: member.id },
      body: { role_ids: roleIds },
    })
  }

  return (
    <Dialog
      handle={detailsDialogHandle}
      onOpenChange={(open, details) => {
        if (!open && isSavingMember) details.cancel()
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
            <div
              ref={listRef}
              tabIndex={-1}
              role="region"
              aria-label={t(($) => $['settings.members'], { ns: 'navigation' })}
              className="overflow-x-auto focus-visible:outline-2 focus-visible:outline-state-accent-solid"
            >
              <table className="w-full min-w-150 table-fixed text-start">
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
                      onRemove={(row) => {
                        const adjacentFocusTargets = getAdjacentFocusTargets(row, (sibling) =>
                          sibling.querySelector<HTMLButtonElement>(
                            'button[aria-haspopup="dialog"]',
                          ),
                        )
                        removeDialog.openWithPayload({
                          member: account,
                          adjacentFocusTargets,
                          fallbackFocus: { current: null },
                        })
                      }}
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
            handle={removeDialog}
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
                backdropProps={{ forceRender: true }}
                finalFocus={() => {
                  const fallback = payload?.fallbackFocus.current
                  if (!fallback) return true
                  const target =
                    payload.adjacentFocusTargets.find((element) => element.isConnected) ?? fallback
                  target.focus({ preventScroll: true })
                  return false
                }}
              >
                <AlertDialogHeader>
                  <AlertDialogTitle>
                    {t(($) => $['members.removeFromTeamConfirmTitle'], {
                      ns: 'workspaceMembers',
                      memberName: payload?.member.name || payload?.member.email || '',
                    })}
                  </AlertDialogTitle>
                  <AlertDialogDescription>
                    {t(($) => $['members.removeFromTeamConfirmDescription'], {
                      ns: 'workspaceMembers',
                    })}
                  </AlertDialogDescription>
                  {removal.isError && (
                    <p role="alert" className="text-text-destructive">
                      {t(($) => $['api.actionFailed'], { ns: 'common' })}
                    </p>
                  )}
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancelButton disabled={removal.isPending}>
                    {t(($) => $['operation.cancel'], { ns: 'common' })}
                  </AlertDialogCancelButton>
                  <AlertDialogConfirmButton
                    loading={removal.isPending}
                    onClick={() => {
                      if (!payload || removal.isPending) return
                      removal.mutate(
                        { params: { member_id: payload.member.id } },
                        {
                          onSuccess: () => {
                            payload.fallbackFocus.current = listRef.current
                            removeDialog.close()
                          },
                        },
                      )
                    }}
                  >
                    {t(($) => $['operation.confirm'], { ns: 'common' })}
                  </AlertDialogConfirmButton>
                </AlertDialogFooter>
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
                onAssignSubmit={(roles) => handleAssignRolesSubmit(member, roles)}
              />
            )}
          </DialogContent>
        </>
      )}
    </Dialog>
  )
}

export default MembersPage
