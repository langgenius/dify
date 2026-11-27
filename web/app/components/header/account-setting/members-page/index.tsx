'use client'
import type { AccountWithRoleResponse } from '@dify/contracts/api/console/workspaces/types.gen'
import type { DialogActions } from '@langgenius/dify-ui/dialog'
import type { Invitee } from './invited-row'
import {
  AlertDialog,
  AlertDialogBody,
  AlertDialogCancelButton,
  AlertDialogConfirmButton,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  createAlertDialogHandle,
} from '@langgenius/dify-ui/alert-dialog'
import { Avatar, AvatarFallback, AvatarImage } from '@langgenius/dify-ui/avatar'
import { Checkbox } from '@langgenius/dify-ui/checkbox'
import { Dialog, DialogContent, DialogTrigger } from '@langgenius/dify-ui/dialog'
import { Field, FieldLabel } from '@langgenius/dify-ui/field'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { Infotip, InfotipContent, InfotipTrigger } from '@langgenius/dify-ui/infotip'
import { Tooltip, TooltipContent, TooltipTrigger } from '@langgenius/dify-ui/tooltip'
import { isDefinedError } from '@orpc/client'
import {
  useMutation,
  usePrefetchQuery,
  useSuspenseQueries,
  useSuspenseQuery,
} from '@tanstack/react-query'
import { useAtomValue } from 'jotai'
import { Suspense, useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocale } from '#i18n'
import { WorkspaceAvatar } from '@/app/components/base/workspace-avatar'
import { getCountQuota, isQuotaReached } from '@/app/components/billing/quota'
import UpgradeBtn from '@/app/components/billing/upgrade-btn'
import { toast } from '@/app/notifications'
import { workspacePermissionKeysAtom } from '@/context/permission-state'
import {
  currentWorkspaceAtom,
  currentWorkspaceIdAtom,
  isCurrentWorkspaceOwnerAtom,
} from '@/context/workspace-state'
import { userProfileQueryOptions } from '@/features/account-profile/client'
import { isContactsManagementEnabled } from '@/features/contacts/management/feature-flag'
import { canManageContactsAtom } from '@/features/contacts/permissions'
import { systemFeaturesQueryOptions } from '@/features/system-features/client'
import { getAccessControlTemplateLanguage, LanguagesSupported } from '@/i18n/language'
import { consoleQuery } from '@/service/console'
import { getAdjacentFocusTargets } from '@/utils/get-adjacent-focus-targets'
import { hasPermission } from '@/utils/permission'
import { EditWorkspaceContent } from './edit-workspace-content'
import { InviteModal } from './invite-modal'
import { InvitedRow } from './invited-row'
import { MemberDetailsContent } from './member-details-content'
import { MemberRow } from './member-row'
import { MembersHeaderCard } from './members-header-card'
import { MembersPageSkeleton } from './members-page-skeleton'
import { keepPlatformContactField, useMemberRemoval } from './use-member-removal'

const revealRow = (row: HTMLTableRowElement | null) => row?.scrollIntoView({ block: 'nearest' })

type MembersLanguage = ReturnType<typeof getAccessControlTemplateLanguage>

const membersQueryOptions = (language: MembersLanguage) =>
  consoleQuery.workspaces.current.members.get.queryOptions({
    input: { query: { language } },
    staleTime: 0,
  })

const pendingInvitationsQueryOptions = (workspaceId: string) =>
  consoleQuery.workspaces.byWorkspaceId.members.pendingInvitations.get.queryOptions({
    input: { params: { workspace_id: workspaceId } },
    staleTime: 0,
  })

const PendingInvitationsPrefetch = ({ workspaceId }: { workspaceId: string }) => {
  usePrefetchQuery(pendingInvitationsQueryOptions(workspaceId))
  return null
}

type MembersPageContentProps = {
  language: MembersLanguage
  canManageMembers: boolean
}

const MembersPageContent = ({ language, canManageMembers }: MembersPageContentProps) => {
  const { t } = useTranslation([
    'billing',
    'common',
    'workspaceMembers',
    'accountSettings',
    'permission',
    'navigation',
    'contacts',
  ])
  const locale = useLocale()

  const { data: userProfileEmail } = useSuspenseQuery({
    ...userProfileQueryOptions(),
    select: (data) => data.profile.email,
  })
  const currentWorkspace = useAtomValue(currentWorkspaceAtom)
  const isCurrentWorkspaceOwner = useAtomValue(isCurrentWorkspaceOwnerAtom)
  const canManageContacts = useAtomValue(canManageContactsAtom)
  const { accounts, features } = useSuspenseQueries({
    queries: [membersQueryOptions(language), consoleQuery.features.get.queryOptions()],
    combine: ([members, featureResult]) => ({
      accounts: members.data.accounts,
      features: {
        plan: featureResult.data.billing.subscription.plan,
        members: getCountQuota(featureResult.data.members),
        is_allow_transfer_workspace: featureResult.data.is_allow_transfer_workspace,
        imCentrallyManaged: featureResult.data.im_centrally_managed,
      },
    }),
  })
  const invitationQueries: Array<ReturnType<typeof pendingInvitationsQueryOptions>> =
    canManageMembers && currentWorkspace.id
      ? [pendingInvitationsQueryOptions(currentWorkspace.id)]
      : []
  const invitations = useSuspenseQueries({
    queries: invitationQueries,
    combine: (results) => results.flatMap(({ data }) => data.invitations),
  })
  const { data: systemFeatures } = useSuspenseQuery(systemFeaturesQueryOptions())
  const keepPlatformLabelId = useId()
  const [invitedEmails, setInvitedEmails] = useState<ReadonlySet<string>>(() => new Set())
  const workspaceNameInputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const removal = useMemberRemoval(listRef)
  const joinedAccounts = accounts.filter((account) => account.status !== 'pending')

  const memberLimit =
    features.plan !== 'team' && features.members.limit !== 'unlimited'
      ? features.members.limit
      : null
  const detailsActionsRef = useRef<DialogActions>(null)

  const invitees: Invitee[] = [
    ...accounts
      .filter((account) => account.status === 'pending')
      .map((account) => ({
        email: account.email,
        role: account.roles?.[0]?.id ?? account.role,
        roleName: account.roles?.[0]?.name ?? account.role,
      })),
    ...invitations.map((invitation) => ({
      email: invitation.email,
      role: invitation.role,
      roleName: invitation.role,
      expiresAt: invitation.expires_at,
    })),
  ]
  const usedSeats = joinedAccounts.length + invitees.length
  const isMemberFull =
    features.plan !== 'team' && isQuotaReached({ usage: usedSeats, limit: features.members.limit })
  const [revokeDialog] = useState(() => createAlertDialogHandle<Invitee>())
  const revocation = useMutation(
    consoleQuery.workspaces.byWorkspaceId.members.pendingInvitations.revoke.post.mutationOptions({
      meta: { errorToast: false },
    }),
  )
  const isInvitationGone = (error: typeof revocation.error) =>
    isDefinedError(error) && error.code === 'pending_invitation_not_found'
  const revocationError =
    revocation.isError && !isInvitationGone(revocation.error)
      ? isDefinedError(revocation.error)
        ? revocation.error.message
        : t(($) => $['api.actionFailed'], { ns: 'common' })
      : null
  const roleColumnLabel = systemFeatures.rbac_enabled
    ? t(($) => $['members.roles'], { ns: 'workspaceMembers' })
    : t(($) => $['members.role'], { ns: 'workspaceMembers' })

  const roleUpdate = useMutation(
    consoleQuery.workspaces.current.rbac.members.byMemberId.rbacRoles.put.mutationOptions({
      meta: { errorToast: false },
    }),
  )

  const canAssignRoles = (member: AccountWithRoleResponse) =>
    canManageMembers && member.role !== 'owner' && member.email !== userProfileEmail

  return (
    <Dialog<AccountWithRoleResponse>
      actionsRef={detailsActionsRef}
      onOpenChange={(open, details) => {
        if (open) roleUpdate.reset()
        else if (roleUpdate.isPending && details.reason !== 'imperative-action') details.cancel()
      }}
    >
      {({ payload: member }) => (
        <>
          <div className="flex flex-col">
            <MembersHeaderCard>
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
                    {memberLimit !== null ? (
                      <div className="flex flex-wrap gap-x-1">
                        <div>
                          {t(($) => $['plansCommon.member'], { ns: 'billing' })}
                          {locale !== LanguagesSupported[1] && usedSeats > 1 && 's'}
                        </div>
                        <div className="flex gap-x-1">
                          <span>{usedSeats}</span>
                          <span>/</span>
                          <span>{memberLimit}</span>
                        </div>
                        {invitees.length > 0 && (
                          <div>
                            ·{' '}
                            {t(($) => $['members.seatsIncludingInvited'], {
                              ns: 'workspaceMembers',
                              count: invitees.length,
                            })}
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="flex gap-x-1">
                        <div className="shrink-0">{joinedAccounts.length}</div>
                        <div>
                          {t(($) => $['plansCommon.memberAfter'], { ns: 'billing' })}
                          {locale !== LanguagesSupported[1] && joinedAccounts.length > 1 && 's'}
                        </div>
                        {invitees.length > 0 && (
                          <div>
                            ·{' '}
                            {t(($) => $['members.invitedCount'], {
                              ns: 'workspaceMembers',
                              count: invitees.length,
                            })}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                {isMemberFull && <UpgradeBtn className="shrink-0" loc="member-invite" />}
                {canManageMembers && (
                  <div className="shrink-0">
                    <InviteModal onSend={(emails) => setInvitedEmails(new Set(emails))} />
                  </div>
                )}
              </div>
            </MembersHeaderCard>
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
                  {joinedAccounts.map((account) => (
                    <MemberRow
                      key={account.id}
                      ref={invitedEmails.has(account.email.toLowerCase()) ? revealRow : undefined}
                      member={account}
                      onRemove={(row) => {
                        const adjacentFocusTargets = getAdjacentFocusTargets(row, (sibling) =>
                          sibling.querySelector<HTMLButtonElement>(
                            'button[aria-haspopup="dialog"]',
                          ),
                        )
                        removal.dialog.openWithPayload({
                          member: account,
                          adjacentFocusTargets,
                          fallbackFocus: { current: null },
                        })
                      }}
                      isCurrentUser={userProfileEmail === account.email}
                      canManage={canManageMembers}
                      canTransferOwnership={
                        isCurrentWorkspaceOwner && features.is_allow_transfer_workspace
                      }
                      allowMultipleRoles={systemFeatures.rbac_enabled}
                    />
                  ))}
                  {invitees.map((invitee) => (
                    <InvitedRow
                      key={invitee.email}
                      ref={invitedEmails.has(invitee.email.toLowerCase()) ? revealRow : undefined}
                      invitee={invitee}
                      canManage={canManageMembers}
                      onRevoke={() => {
                        revocation.reset()
                        revokeDialog.openWithPayload(invitee)
                      }}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <AlertDialog
            handle={revokeDialog}
            onOpenChange={(open, details) => {
              if (!open && revocation.isPending && details.reason !== 'imperative-action')
                details.cancel()
            }}
          >
            {({ payload: invitee }) => (
              <AlertDialogContent
                backdropProps={{ forceRender: true }}
                finalFocus={() => {
                  if (!revocation.isSuccess) return true
                  listRef.current?.focus({ preventScroll: true })
                  return false
                }}
              >
                <AlertDialogHeader>
                  <AlertDialogTitle>
                    {t(($) => $['members.revokeInvitationTitle'], {
                      ns: 'workspaceMembers',
                      email: invitee?.email ?? '',
                    })}
                  </AlertDialogTitle>
                  <AlertDialogDescription>
                    {t(($) => $['members.revokeInvitationDescription'], {
                      ns: 'workspaceMembers',
                    })}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                {revocationError && (
                  <AlertDialogBody>
                    <p role="alert" className="text-text-destructive">
                      {revocationError}
                    </p>
                  </AlertDialogBody>
                )}
                <AlertDialogFooter>
                  <AlertDialogCancelButton disabled={revocation.isPending}>
                    {t(($) => $['operation.cancel'], { ns: 'common' })}
                  </AlertDialogCancelButton>
                  <AlertDialogConfirmButton
                    loading={revocation.isPending}
                    onClick={() => {
                      if (!invitee || revocation.isPending) return
                      revocation.mutate(
                        {
                          params: { workspace_id: currentWorkspace.id },
                          body: { email: invitee.email },
                        },
                        {
                          onSuccess: () => revokeDialog.close(),
                          onError: (error) => {
                            if (!isInvitationGone(error)) return
                            revokeDialog.close()
                            toast.warning(
                              t(($) => $['members.invitationNoLongerPending'], {
                                ns: 'workspaceMembers',
                                email: invitee.email,
                              }),
                            )
                          },
                        },
                      )
                    }}
                  >
                    {t(($) => $['members.revokeInvitation'], { ns: 'workspaceMembers' })}
                  </AlertDialogConfirmButton>
                </AlertDialogFooter>
              </AlertDialogContent>
            )}
          </AlertDialog>
          <AlertDialog
            handle={removal.dialog}
            onOpenChange={(open, details) => {
              if (!open && removal.isPending && details.reason !== 'imperative-action')
                details.cancel()
            }}
            onOpenChangeComplete={(open) => {
              if (!open) {
                removal.reset()
              }
            }}
          >
            {({ payload }) => {
              const showContactsRemovalDesign = Boolean(
                payload && isContactsManagementEnabled() && payload.member.status !== 'pending',
              )
              const showKeepPlatformContact =
                showContactsRemovalDesign &&
                payload?.member.status === 'active' &&
                features.imCentrallyManaged &&
                (!systemFeatures.rbac_enabled || canManageContacts)
              const memberName = payload?.member.name || payload?.member.email || ''
              return (
                <AlertDialogContent
                  backdropProps={{ forceRender: true }}
                  className={showContactsRemovalDesign ? 'w-110' : undefined}
                  finalFocus={() => {
                    const fallback = payload?.fallbackFocus.current
                    if (!fallback) return true
                    const target =
                      payload.adjacentFocusTargets.find((element) => element.isConnected) ??
                      fallback
                    target.focus({ preventScroll: true })
                    return false
                  }}
                >
                  <form className="contents" onSubmit={removal.getSubmitHandler(payload)}>
                    {showContactsRemovalDesign && payload ? (
                      <>
                        <AlertDialogHeader>
                          <AlertDialogTitle>
                            {t(
                              ($) =>
                                $[
                                  currentWorkspace.name
                                    ? 'memberRemoval.workspaceTitle'
                                    : 'memberRemoval.title'
                                ],
                              {
                                ns: 'contacts',
                                memberName,
                                workspaceName: currentWorkspace.name,
                              },
                            )}
                          </AlertDialogTitle>
                        </AlertDialogHeader>
                        <AlertDialogBody className="flex flex-col gap-2">
                          <div className="flex items-center gap-2.5 rounded-xl bg-background-section-burn py-2 ps-3 pe-2">
                            <Avatar size="md">
                              <AvatarImage src={payload.member.avatar_url || undefined} alt="" />
                              <AvatarFallback aria-hidden>
                                {memberName[0]?.toLocaleUpperCase()}
                              </AvatarFallback>
                            </Avatar>
                            <div className="min-w-0 py-0.5">
                              <div className="system-md-medium wrap-break-word text-text-secondary">
                                {memberName}
                              </div>
                              <div className="system-xs-regular wrap-anywhere text-text-tertiary">
                                {payload.member.email}
                              </div>
                            </div>
                          </div>
                          <AlertDialogDescription render={<div />}>
                            <p>
                              {t(($) => $['memberRemoval.accessImpact'], {
                                ns: 'contacts',
                                memberName,
                              })}
                            </p>
                            <p>{t(($) => $['memberRemoval.contentImpact'], { ns: 'contacts' })}</p>
                          </AlertDialogDescription>
                          {showKeepPlatformContact && (
                            <div className="flex items-center gap-1.5">
                              <Field
                                className="flex items-center gap-2"
                                name={keepPlatformContactField}
                                disabled={removal.isPending}
                              >
                                <Checkbox />
                                <FieldLabel id={keepPlatformLabelId} className="system-sm-regular">
                                  {t(($) => $['memberRemoval.keepPlatform'], { ns: 'contacts' })}
                                </FieldLabel>
                              </Field>
                              <Infotip>
                                <InfotipTrigger
                                  aria-labelledby={keepPlatformLabelId}
                                  size="sm"
                                  type="button"
                                />
                                <InfotipContent aria-labelledby={keepPlatformLabelId}>
                                  {t(($) => $['memberRemoval.keepPlatformDescription'], {
                                    ns: 'contacts',
                                  })}
                                </InfotipContent>
                              </Infotip>
                            </div>
                          )}
                          {removal.isError && (
                            <p role="alert" className="text-text-destructive">
                              {t(($) => $['api.actionFailed'], { ns: 'common' })}
                            </p>
                          )}
                        </AlertDialogBody>
                      </>
                    ) : (
                      <>
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
                        </AlertDialogHeader>
                        {removal.isError && (
                          <AlertDialogBody>
                            <p role="alert" className="text-text-destructive">
                              {t(($) => $['api.actionFailed'], { ns: 'common' })}
                            </p>
                          </AlertDialogBody>
                        )}
                      </>
                    )}
                    <AlertDialogFooter>
                      <AlertDialogCancelButton disabled={removal.isPending}>
                        {t(($) => $['operation.cancel'], { ns: 'common' })}
                      </AlertDialogCancelButton>
                      <AlertDialogConfirmButton type="submit" loading={removal.isPending}>
                        {showContactsRemovalDesign
                          ? t(($) => $['memberRemoval.remove'], { ns: 'contacts' })
                          : t(($) => $['operation.confirm'], { ns: 'common' })}
                      </AlertDialogConfirmButton>
                    </AlertDialogFooter>
                  </form>
                </AlertDialogContent>
              )
            }}
          </AlertDialog>
          <DialogContent className="w-110" backdropProps={{ forceRender: true }}>
            {member && (
              <form
                className="contents"
                key={member.id}
                onSubmit={(event) => {
                  event.preventDefault()
                  if (!canAssignRoles(member) || roleUpdate.isPending) return
                  const roleIds = new FormData(event.currentTarget).getAll('roleId').map(String)
                  roleUpdate.mutate(
                    { params: { member_id: member.id }, body: { role_ids: roleIds } },
                    { onSuccess: () => detailsActionsRef.current?.close() },
                  )
                }}
              >
                <fieldset className="contents" disabled={roleUpdate.isPending}>
                  <MemberDetailsContent
                    member={member}
                    canAssignRoles={canAssignRoles(member)}
                    saving={roleUpdate.isPending}
                    allowMultipleRoles={systemFeatures.rbac_enabled}
                  />
                </fieldset>
                {roleUpdate.isError && (
                  <p role="alert">{t(($) => $['api.actionFailed'], { ns: 'common' })}</p>
                )}
              </form>
            )}
          </DialogContent>
        </>
      )}
    </Dialog>
  )
}

export function MembersPage() {
  const language = getAccessControlTemplateLanguage(useLocale())
  const workspaceId = useAtomValue(currentWorkspaceIdAtom)
  const canManageMembers = hasPermission(
    useAtomValue(workspacePermissionKeysAtom),
    'workspace.member.manage',
  )
  usePrefetchQuery(membersQueryOptions(language))
  usePrefetchQuery(consoleQuery.features.get.queryOptions())

  return (
    <>
      {canManageMembers && workspaceId && <PendingInvitationsPrefetch workspaceId={workspaceId} />}
      <Suspense fallback={<MembersPageSkeleton />}>
        <MembersPageContent language={language} canManageMembers={canManageMembers} />
      </Suspense>
    </>
  )
}
