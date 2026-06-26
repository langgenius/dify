'use client'

import type { RoleKey } from '../members-page/invite-modal/role-selector'
import type { InvitationResult, Member } from '@/models/common'
import type { PlatformAdminWorkspace } from '@/models/platform-admin'
import { Avatar } from '@langgenius/dify-ui/avatar'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { Dialog, DialogContent, DialogTitle } from '@langgenius/dify-ui/dialog'
import { toast } from '@langgenius/dify-ui/toast'
import { useDeferredValue, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Input from '@/app/components/base/input'
import SearchInput from '@/app/components/base/search-input'
import Textarea from '@/app/components/base/textarea'
import { emailRegex, validPassword } from '@/config'
import { useAppContext } from '@/context/app-context'
import { useLocale } from '@/context/i18n'
import { useProviderContext } from '@/context/provider-context'
import {
  useCreatePlatformAdminWorkspace,
  useDeletePlatformAdminWorkspace,
  useDeletePlatformAdminWorkspaceMember,
  useInvitePlatformAdminWorkspaceMembers,
  usePlatformAdminWorkspaceMembers,
  usePlatformAdminWorkspaces,
  useRenamePlatformAdminWorkspace,
  useResetPlatformAdminWorkspaceMemberPassword,
  useUpdatePlatformAdminWorkspaceMemberRole,
} from '@/service/use-platform-admin'
import InvitedModal from '../members-page/invited-modal'
import EnterpriseMarketplaceAdmin from './enterprise-marketplace-admin'

const roleLabels = {
  owner: 'members.owner',
  admin: 'members.admin',
  editor: 'members.editor',
  dataset_operator: 'members.datasetOperator',
  normal: 'members.normal',
} as const

const nonOwnerRoles: RoleKey[] = ['admin', 'editor', 'normal', 'dataset_operator']

type PlatformAdminSection = 'workspaces' | 'marketplace'

type WorkspaceDialogState
  = | { type: 'create' }
    | { type: 'rename', workspace: PlatformAdminWorkspace }
    | { type: 'invite', workspace: PlatformAdminWorkspace }
    | { type: 'resetPassword', member: Member }
    | null

const generateTemporaryPassword = () => {
  const randomPart = Math.random().toString(36).slice(2, 10)
  const randomNumber = Math.floor(1000 + Math.random() * 9000)
  return `Dify${randomPart}${randomNumber}`
}

const PlatformAdminDialog = ({
  open,
  title,
  children,
  onClose,
}: {
  open: boolean
  title: string
  children: React.ReactNode
  onClose: () => void
}) => (
  <Dialog open={open} onOpenChange={nextOpen => !nextOpen && onClose()}>
    <DialogContent className="max-w-[560px] p-0">
      <div className="border-b border-divider-subtle px-6 py-5">
        <DialogTitle className="title-xl-semi-bold text-text-primary">{title}</DialogTitle>
      </div>
      {children}
    </DialogContent>
  </Dialog>
)

const CreateWorkspaceDialog = ({
  open,
  loading,
  onClose,
  onSubmit,
}: {
  open: boolean
  loading: boolean
  onClose: () => void
  onSubmit: (payload: { name: string, owner_email?: string, owner_name?: string }) => void
}) => {
  const { t } = useTranslation()
  const [name, setName] = useState('')
  const [ownerEmail, setOwnerEmail] = useState('')
  const [ownerName, setOwnerName] = useState('')

  const handleSubmit = () => {
    const normalizedOwnerEmail = ownerEmail.trim().toLowerCase()
    if (normalizedOwnerEmail && !emailRegex.test(normalizedOwnerEmail)) {
      toast.error(t('members.emailInvalid', { ns: 'common' }))
      return
    }

    onSubmit({
      name: name.trim(),
      owner_email: normalizedOwnerEmail || undefined,
      owner_name: ownerName.trim() || undefined,
    })
  }

  return (
    <PlatformAdminDialog open={open} title={t('platformAdmin.createWorkspace', { ns: 'common' })} onClose={onClose}>
      <div className="space-y-4 px-6 py-5">
        <label className="block">
          <div className="mb-1 system-sm-medium text-text-secondary">{t('platformAdmin.workspaceName', { ns: 'common' })}</div>
          <Input value={name} onChange={e => setName(e.target.value)} maxLength={255} />
        </label>
        <label className="block">
          <div className="mb-1 system-sm-medium text-text-secondary">{t('platformAdmin.ownerEmail', { ns: 'common' })}</div>
          <Input
            value={ownerEmail}
            onChange={e => setOwnerEmail(e.target.value)}
            placeholder={t('platformAdmin.ownerEmailPlaceholder', { ns: 'common' })}
          />
        </label>
        <label className="block">
          <div className="mb-1 system-sm-medium text-text-secondary">{t('platformAdmin.ownerName', { ns: 'common' })}</div>
          <Input
            value={ownerName}
            onChange={e => setOwnerName(e.target.value)}
            placeholder={t('platformAdmin.ownerNamePlaceholder', { ns: 'common' })}
          />
        </label>
        <div className="system-xs-regular text-text-tertiary">
          {t('platformAdmin.createWorkspaceTip', { ns: 'common' })}
        </div>
      </div>
      <div className="flex justify-end gap-2 border-t border-divider-subtle px-6 py-4">
        <Button onClick={onClose}>{t('operation.cancel', { ns: 'common' })}</Button>
        <Button variant="primary" loading={loading} disabled={!name.trim()} onClick={handleSubmit}>
          {t('operation.create', { ns: 'common' })}
        </Button>
      </div>
    </PlatformAdminDialog>
  )
}

const RenameWorkspaceDialog = ({
  workspace,
  loading,
  onClose,
  onSubmit,
}: {
  workspace: PlatformAdminWorkspace | null
  loading: boolean
  onClose: () => void
  onSubmit: (name: string) => void
}) => {
  const { t } = useTranslation()
  const [name, setName] = useState(workspace?.name || '')

  return (
    <PlatformAdminDialog open={!!workspace} title={t('platformAdmin.renameWorkspace', { ns: 'common' })} onClose={onClose}>
      <div className="px-6 py-5">
        <div className="mb-1 system-sm-medium text-text-secondary">{t('platformAdmin.workspaceName', { ns: 'common' })}</div>
        <Input value={name} onChange={e => setName(e.target.value)} maxLength={255} />
      </div>
      <div className="flex justify-end gap-2 border-t border-divider-subtle px-6 py-4">
        <Button onClick={onClose}>{t('operation.cancel', { ns: 'common' })}</Button>
        <Button variant="primary" loading={loading} disabled={!name.trim()} onClick={() => onSubmit(name.trim())}>
          {t('operation.save', { ns: 'common' })}
        </Button>
      </div>
    </PlatformAdminDialog>
  )
}

const InviteMembersDialog = ({
  workspace,
  loading,
  roleOptions,
  onClose,
  onSubmit,
}: {
  workspace: PlatformAdminWorkspace | null
  loading: boolean
  roleOptions: RoleKey[]
  onClose: () => void
  onSubmit: (payload: { emails: string[], role: RoleKey, language: string }) => void
}) => {
  const { t } = useTranslation()
  const locale = useLocale()
  const [emailsText, setEmailsText] = useState('')
  const [role, setRole] = useState<RoleKey>('normal')

  const emails = useMemo(
    () => emailsText.split(/[,\n;]/).map(email => email.trim().toLowerCase()).filter(Boolean),
    [emailsText],
  )

  const handleSubmit = () => {
    if (!emails.length)
      return

    if (!emails.every(email => emailRegex.test(email))) {
      toast.error(t('members.emailInvalid', { ns: 'common' }))
      return
    }

    onSubmit({ emails, role, language: locale })
  }

  return (
    <PlatformAdminDialog open={!!workspace} title={t('platformAdmin.inviteMembers', { ns: 'common' })} onClose={onClose}>
      <div className="space-y-4 px-6 py-5">
        <div className="rounded-lg border border-divider-subtle bg-background-body px-3 py-2 system-sm-regular text-text-secondary">
          {workspace?.name}
        </div>
        <label className="block">
          <div className="mb-1 system-sm-medium text-text-secondary">{t('members.email', { ns: 'common' })}</div>
          <Textarea
            value={emailsText}
            onChange={e => setEmailsText(e.target.value)}
            placeholder={t('members.emailPlaceholder', { ns: 'common' })}
          />
        </label>
        <label className="block">
          <div className="mb-1 system-sm-medium text-text-secondary">{t('members.role', { ns: 'common' })}</div>
          <select
            className="h-9 w-full rounded-lg border border-divider-subtle bg-components-input-bg-normal px-3 text-sm text-text-secondary outline-none"
            value={role}
            onChange={e => setRole(e.target.value as RoleKey)}
          >
            {roleOptions.map(option => (
              <option key={option} value={option}>{t(roleLabels[option], { ns: 'common' })}</option>
            ))}
          </select>
        </label>
      </div>
      <div className="flex justify-end gap-2 border-t border-divider-subtle px-6 py-4">
        <Button onClick={onClose}>{t('operation.cancel', { ns: 'common' })}</Button>
        <Button variant="primary" loading={loading} disabled={!emails.length} onClick={handleSubmit}>
          {t('members.sendInvite', { ns: 'common' })}
        </Button>
      </div>
    </PlatformAdminDialog>
  )
}

const ResetMemberPasswordDialog = ({
  member,
  loading,
  onClose,
  onSubmit,
}: {
  member: Member | null
  loading: boolean
  onClose: () => void
  onSubmit: (password: string) => void
}) => {
  const { t } = useTranslation()
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')

  const handleGeneratePassword = () => {
    const generatedPassword = generateTemporaryPassword()
    setPassword(generatedPassword)
    setConfirmPassword(generatedPassword)
  }

  const handleCopyPassword = async () => {
    if (!password)
      return

    await navigator.clipboard.writeText(password)
    toast.success(t('actionMsg.copySuccessfully', { ns: 'common' }))
  }

  const handleSubmit = () => {
    if (!password.trim()) {
      toast.error(t('error.passwordEmpty', { ns: 'login' }))
      return
    }

    if (!validPassword.test(password)) {
      toast.error(t('error.passwordInvalid', { ns: 'login' }))
      return
    }

    if (password !== confirmPassword) {
      toast.error(t('platformAdmin.passwordMismatch', { ns: 'common' }))
      return
    }

    onSubmit(password)
  }

  return (
    <PlatformAdminDialog open={!!member} title={t('platformAdmin.resetMemberPassword', { ns: 'common' })} onClose={onClose}>
      <div className="space-y-4 px-6 py-5">
        <div className="rounded-lg border border-divider-subtle bg-background-body px-3 py-2">
          <div className="system-sm-semibold text-text-primary">{member?.name}</div>
          <div className="system-xs-regular text-text-tertiary">{member?.email}</div>
        </div>
        <div className="system-xs-regular text-text-tertiary">
          {t('platformAdmin.resetMemberPasswordTip', { ns: 'common' })}
        </div>
        <label className="block">
          <div className="mb-1 system-sm-medium text-text-secondary">{t('platformAdmin.temporaryPassword', { ns: 'common' })}</div>
          <Input
            value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder={t('platformAdmin.temporaryPasswordPlaceholder', { ns: 'common' })}
          />
        </label>
        <label className="block">
          <div className="mb-1 system-sm-medium text-text-secondary">{t('platformAdmin.confirmTemporaryPassword', { ns: 'common' })}</div>
          <Input
            value={confirmPassword}
            onChange={e => setConfirmPassword(e.target.value)}
            placeholder={t('platformAdmin.confirmTemporaryPasswordPlaceholder', { ns: 'common' })}
          />
        </label>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={handleGeneratePassword}>
            {t('platformAdmin.generateTemporaryPassword', { ns: 'common' })}
          </Button>
          <Button variant="secondary" disabled={!password} onClick={handleCopyPassword}>
            {t('operation.copy', { ns: 'common' })}
          </Button>
        </div>
      </div>
      <div className="flex justify-end gap-2 border-t border-divider-subtle px-6 py-4">
        <Button onClick={onClose}>{t('operation.cancel', { ns: 'common' })}</Button>
        <Button variant="primary" loading={loading} disabled={!password || !confirmPassword} onClick={handleSubmit}>
          {t('operation.save', { ns: 'common' })}
        </Button>
      </div>
    </PlatformAdminDialog>
  )
}

const PlatformAdminPage = () => {
  const { t } = useTranslation()
  const { currentWorkspace } = useAppContext()
  const { datasetOperatorEnabled } = useProviderContext()
  const [section, setSection] = useState<PlatformAdminSection>('workspaces')
  const [keyword, setKeyword] = useState('')
  const deferredKeyword = useDeferredValue(keyword)
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState('')
  const [dialog, setDialog] = useState<WorkspaceDialogState>(null)
  const [invitationResults, setInvitationResults] = useState<InvitationResult[]>([])

  const workspaceQuery = usePlatformAdminWorkspaces({ keyword: deferredKeyword }, section === 'workspaces')
  const workspaces = useMemo(() => workspaceQuery.data?.items || [], [workspaceQuery.data?.items])
  const activeWorkspaceId = workspaces.some(workspace => workspace.id === selectedWorkspaceId)
    ? selectedWorkspaceId
    : workspaces[0]?.id || ''
  const selectedWorkspace = workspaces.find(workspace => workspace.id === activeWorkspaceId) || null
  const membersQuery = usePlatformAdminWorkspaceMembers(activeWorkspaceId, section === 'workspaces' && !!activeWorkspaceId)
  const members = membersQuery.data?.accounts || []

  const createWorkspaceMutation = useCreatePlatformAdminWorkspace()
  const renameWorkspaceMutation = useRenamePlatformAdminWorkspace(activeWorkspaceId)
  const deleteWorkspaceMutation = useDeletePlatformAdminWorkspace()
  const inviteMembersMutation = useInvitePlatformAdminWorkspaceMembers(activeWorkspaceId)
  const updateRoleMutation = useUpdatePlatformAdminWorkspaceMemberRole(activeWorkspaceId)
  const removeMemberMutation = useDeletePlatformAdminWorkspaceMember(activeWorkspaceId)
  const resetPasswordMutation = useResetPlatformAdminWorkspaceMemberPassword(activeWorkspaceId)

  const roleOptions = useMemo<RoleKey[]>(() => {
    return datasetOperatorEnabled ? nonOwnerRoles : nonOwnerRoles.filter(role => role !== 'dataset_operator')
  }, [datasetOperatorEnabled])

  const handleCreateWorkspace = (payload: { name: string, owner_email?: string, owner_name?: string }) => {
    createWorkspaceMutation.mutate(payload, {
      onSuccess: (response) => {
        setDialog(null)
        setSelectedWorkspaceId(response.workspace.id)
        if (response.owner_invitation_url && response.workspace.owner?.email) {
          setInvitationResults([{
            status: 'success',
            email: response.workspace.owner.email,
            url: response.owner_invitation_url,
          }])
        }
      },
      onError: error => toast.error(error.message),
    })
  }

  const handleRenameWorkspace = (name: string) => {
    renameWorkspaceMutation.mutate(name, {
      onSuccess: () => setDialog(null),
      onError: error => toast.error(error.message),
    })
  }

  const handleDeleteWorkspace = () => {
    if (!selectedWorkspace)
      return
    // eslint-disable-next-line no-alert
    if (!window.confirm(t('platformAdmin.deleteWorkspaceConfirm', { ns: 'common', name: selectedWorkspace.name })))
      return

    deleteWorkspaceMutation.mutate(selectedWorkspace.id, {
      onSuccess: () => {
        toast.success(t('platformAdmin.deleteWorkspaceSuccess', { ns: 'common' }))
        setSelectedWorkspaceId('')
      },
      onError: error => toast.error(error.message || t('platformAdmin.deleteWorkspaceFailed', { ns: 'common' })),
    })
  }

  const handleInviteMembers = (payload: { emails: string[], role: RoleKey, language: string }) => {
    inviteMembersMutation.mutate(payload, {
      onSuccess: (response) => {
        setDialog(null)
        setInvitationResults(response.invitation_results)
      },
      onError: error => toast.error(error.message),
    })
  }

  const handleResetMemberPassword = (member: Member, password: string) => {
    resetPasswordMutation.mutate({
      memberId: member.id,
      new_password: password,
      password_confirm: password,
    }, {
      onSuccess: () => {
        toast.success(t('platformAdmin.resetMemberPasswordSuccess', { ns: 'common' }))
        setDialog(null)
      },
      onError: error => toast.error(error.message || t('platformAdmin.resetMemberPasswordFailed', { ns: 'common' })),
    })
  }

  const canDeleteSelectedWorkspace = !!selectedWorkspace
    && selectedWorkspace.id !== currentWorkspace.id
    && workspaces.length > 1

  return (
    <>
      <div className="space-y-4">
        <div className="flex flex-wrap gap-2">
          {(['workspaces', 'marketplace'] as PlatformAdminSection[]).map(item => (
            <button
              key={item}
              type="button"
              className={cn(
                'rounded-full border px-3 py-1.5 text-sm',
                section === item
                  ? 'border-components-button-primary-border bg-state-base-hover text-text-primary'
                  : 'border-divider-subtle text-text-tertiary hover:bg-state-base-hover',
              )}
              onClick={() => setSection(item)}
            >
              {item === 'workspaces'
                ? t('platformAdmin.workspaceList', { ns: 'common' })
                : t('enterpriseMarketplace.adminSectionTitle', { ns: 'common' })}
            </button>
          ))}
        </div>

        {section === 'marketplace' && <EnterpriseMarketplaceAdmin />}

        {section === 'workspaces' && (
          <div className="grid gap-4 xl:grid-cols-[320px_minmax(0,1fr)]">
            <div className="rounded-lg border border-divider-subtle bg-components-panel-bg p-4">
              <div className="mb-4 flex items-center justify-between gap-3">
                <div>
                  <div className="title-md-semi-bold text-text-primary">{t('platformAdmin.workspaceList', { ns: 'common' })}</div>
                  <div className="mt-1 system-xs-regular text-text-tertiary">
                    {t('platformAdmin.workspaceCount', { ns: 'common', count: workspaceQuery.data?.total || 0 })}
                  </div>
                </div>
                <Button variant="primary" size="small" onClick={() => setDialog({ type: 'create' })}>
                  {t('operation.create', { ns: 'common' })}
                </Button>
              </div>
              <SearchInput className="mb-4" value={keyword} onChange={setKeyword} />
              <div className="space-y-2">
                {workspaces.map(workspace => (
                  <button
                    key={workspace.id}
                    type="button"
                    className={cn(
                      'w-full rounded-lg border p-3 text-left transition-colors',
                      workspace.id === activeWorkspaceId
                        ? 'border-components-button-primary-border bg-state-base-hover'
                        : 'border-divider-subtle bg-background-body hover:bg-state-base-hover',
                    )}
                    onClick={() => setSelectedWorkspaceId(workspace.id)}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="truncate system-sm-semibold text-text-primary">{workspace.name}</div>
                      <div className="rounded-md bg-background-default px-2 py-1 system-2xs-medium-uppercase text-text-tertiary">
                        {workspace.member_count}
                      </div>
                    </div>
                    <div className="mt-2 truncate system-xs-regular text-text-tertiary">
                      {workspace.owner?.email || t('platformAdmin.ownerless', { ns: 'common' })}
                    </div>
                  </button>
                ))}
                {!workspaceQuery.isLoading && !workspaces.length && (
                  <div className="rounded-lg border border-dashed border-divider-subtle px-4 py-10 text-center system-sm-regular text-text-tertiary">
                    {t('platformAdmin.noWorkspaces', { ns: 'common' })}
                  </div>
                )}
              </div>
            </div>

            <div className="rounded-lg border border-divider-subtle bg-components-panel-bg p-4">
              {!selectedWorkspace && (
                <div className="flex min-h-[360px] items-center justify-center system-sm-regular text-text-tertiary">
                  {t('platformAdmin.selectWorkspace', { ns: 'common' })}
                </div>
              )}

              {selectedWorkspace && (
                <>
                  <div className="mb-4 flex flex-col gap-4 rounded-lg border border-divider-subtle bg-background-body p-4 lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <div className="truncate title-xl-semi-bold text-text-primary">{selectedWorkspace.name}</div>
                        <button
                          type="button"
                          className="rounded-md p-1 text-text-tertiary hover:bg-state-base-hover"
                          onClick={() => setDialog({ type: 'rename', workspace: selectedWorkspace })}
                        >
                          <span className="i-ri-pencil-line h-4 w-4" />
                        </button>
                      </div>
                      <div className="mt-2 flex flex-wrap gap-4 system-sm-regular text-text-tertiary">
                        <span>{t('platformAdmin.memberCount', { ns: 'common', count: selectedWorkspace.member_count })}</span>
                        <span>{selectedWorkspace.owner?.email || t('platformAdmin.ownerless', { ns: 'common' })}</span>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        variant="secondary"
                        tone="destructive"
                        loading={deleteWorkspaceMutation.isPending}
                        disabled={!canDeleteSelectedWorkspace}
                        onClick={handleDeleteWorkspace}
                      >
                        {t('platformAdmin.deleteWorkspace', { ns: 'common' })}
                      </Button>
                      <Button variant="secondary" onClick={() => void membersQuery.refetch()}>
                        {t('platformAdmin.refreshMembers', { ns: 'common' })}
                      </Button>
                      <Button variant="primary" onClick={() => setDialog({ type: 'invite', workspace: selectedWorkspace })}>
                        {t('platformAdmin.inviteMembers', { ns: 'common' })}
                      </Button>
                    </div>
                  </div>

                  <div className="overflow-hidden rounded-lg border border-divider-subtle">
                    <div className="hidden border-b border-divider-subtle bg-background-body px-4 py-3 system-xs-medium-uppercase text-text-tertiary lg:flex lg:items-center lg:gap-3">
                      <div className="min-w-[220px] flex-1">{t('members.name', { ns: 'common' })}</div>
                      <div className="w-[160px] shrink-0">{t('members.role', { ns: 'common' })}</div>
                      <div className="w-[120px] shrink-0">{t('platformAdmin.passwordActions', { ns: 'common' })}</div>
                      <div className="w-[80px] shrink-0">{t('platformAdmin.memberActions', { ns: 'common' })}</div>
                    </div>
                    {members.map(member => (
                      <div key={member.id} className="flex flex-wrap items-center gap-3 border-b border-divider-subtle px-4 py-3 last:border-b-0">
                        <div className="flex min-w-[220px] flex-1 basis-[240px] items-center gap-3">
                          <Avatar avatar={member.avatar_url} size="sm" className="shrink-0" name={member.name} />
                          <div className="min-w-0">
                            <div className="truncate system-sm-semibold text-text-primary">{member.name}</div>
                            <div className="truncate system-xs-regular text-text-tertiary">{member.email}</div>
                          </div>
                        </div>
                        <div className="w-[160px] shrink-0">
                          {member.role === 'owner'
                            ? (
                                <div className="system-sm-medium text-text-secondary">
                                  {t(roleLabels.owner, { ns: 'common' })}
                                </div>
                              )
                            : (
                                <select
                                  className="h-9 w-full rounded-lg border border-divider-subtle bg-components-input-bg-normal px-3 text-sm text-text-secondary outline-none"
                                  value={member.role}
                                  disabled={updateRoleMutation.isPending}
                                  onChange={e => updateRoleMutation.mutate({
                                    memberId: member.id,
                                    role: e.target.value as RoleKey,
                                  })}
                                >
                                  {roleOptions.map(option => (
                                    <option key={option} value={option}>{t(roleLabels[option], { ns: 'common' })}</option>
                                  ))}
                                </select>
                              )}
                        </div>
                        <div className="w-[120px] shrink-0">
                          <Button
                            size="small"
                            variant="tertiary"
                            disabled={member.status !== 'active'}
                            onClick={() => setDialog({ type: 'resetPassword', member })}
                          >
                            {t('platformAdmin.resetPasswordAction', { ns: 'common' })}
                          </Button>
                        </div>
                        <div className="w-[80px] shrink-0">
                          {member.role !== 'owner' && (
                            <Button
                              size="small"
                              variant="tertiary"
                              tone="destructive"
                              loading={removeMemberMutation.isPending}
                              onClick={() => removeMemberMutation.mutate(member.id)}
                            >
                              {t('operation.delete', { ns: 'common' })}
                            </Button>
                          )}
                        </div>
                      </div>
                    ))}
                    {!membersQuery.isLoading && !members.length && (
                      <div className="px-4 py-12 text-center system-sm-regular text-text-tertiary">
                        {t('platformAdmin.noMembers', { ns: 'common' })}
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </div>

      <CreateWorkspaceDialog
        key={dialog?.type === 'create' ? 'create-open' : 'create-closed'}
        open={dialog?.type === 'create'}
        loading={createWorkspaceMutation.isPending}
        onClose={() => setDialog(null)}
        onSubmit={handleCreateWorkspace}
      />
      <RenameWorkspaceDialog
        key={dialog?.type === 'rename' ? dialog.workspace.id : 'rename-closed'}
        workspace={dialog?.type === 'rename' ? dialog.workspace : null}
        loading={renameWorkspaceMutation.isPending}
        onClose={() => setDialog(null)}
        onSubmit={handleRenameWorkspace}
      />
      <InviteMembersDialog
        key={dialog?.type === 'invite' ? dialog.workspace.id : 'invite-closed'}
        workspace={dialog?.type === 'invite' ? dialog.workspace : null}
        loading={inviteMembersMutation.isPending}
        roleOptions={roleOptions}
        onClose={() => setDialog(null)}
        onSubmit={handleInviteMembers}
      />
      <ResetMemberPasswordDialog
        key={dialog?.type === 'resetPassword' ? dialog.member.id : 'reset-password-closed'}
        member={dialog?.type === 'resetPassword' ? dialog.member : null}
        loading={resetPasswordMutation.isPending}
        onClose={() => setDialog(null)}
        onSubmit={(password) => {
          if (dialog?.type === 'resetPassword')
            handleResetMemberPassword(dialog.member, password)
        }}
      />
      {!!invitationResults.length && (
        <InvitedModal invitationResults={invitationResults} onCancel={() => setInvitationResults([])} />
      )}
    </>
  )
}

export default PlatformAdminPage
