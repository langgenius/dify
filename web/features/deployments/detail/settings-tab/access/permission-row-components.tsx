'use client'

import type {
  AccessPermissionKind,
  SelectableAccessSubject,
} from './access-policy'
import type { AccessSubjectSelectionValue } from '@/app/components/app/app-access-control/access-subject-selector/types'
import type { AccessControlDraft } from '@/app/components/app/app-access-control/store'
import { SubjectType } from '@dify/contracts/enterprise/types.gen'
import { cn } from '@langgenius/dify-ui/cn'
import { useTranslation } from 'react-i18next'
import { AccessControlDialog } from '@/app/components/app/app-access-control/access-control-dialog'
import { AccessControlDialogContent } from '@/app/components/app/app-access-control/access-control-dialog-content'
import { useAccessControlStore } from '@/app/components/app/app-access-control/store'
import { AccessControlDraftProvider } from '@/app/components/app/app-access-control/store-provider'
import { SkeletonRectangle } from '@/app/components/base/skeleton'
import { AccessMode as AppAccessMode } from '@/models/access-control'
import {
  appAccessModeToPermissionKey,
  permissionIcon,
} from './access-policy'

export function PermissionSummaryButton({
  value,
  disabled,
  loading,
  environmentLabel,
  onClick,
}: {
  value: AccessPermissionKind
  disabled?: boolean
  loading?: boolean
  environmentLabel: string
  onClick: () => void
}) {
  const { t } = useTranslation('deployments')

  return (
    <button
      type="button"
      disabled={disabled}
      aria-label={t('access.permissions.editAriaLabel', { environment: environmentLabel })}
      onClick={onClick}
      className={cn(
        'inline-flex h-8 w-full min-w-0 items-center gap-2 rounded-lg bg-components-input-bg-normal px-2.5 system-sm-regular text-text-secondary outline-hidden hover:bg-state-base-hover-alt focus-visible:bg-state-base-hover-alt focus-visible:ring-1 focus-visible:ring-components-input-border-active focus-visible:ring-inset',
        disabled && 'cursor-not-allowed opacity-50 hover:bg-components-input-bg-normal',
      )}
    >
      <span
        className={cn(
          loading ? 'i-ri-loader-2-line animate-spin motion-reduce:animate-none' : permissionIcon[value],
          'size-4 shrink-0 text-text-tertiary',
        )}
        aria-hidden="true"
      />
      <span className="flex-1 truncate text-left">{t(`access.permission.${value}`)}</span>
      <span className="i-ri-arrow-right-s-line size-4 shrink-0 text-text-tertiary" aria-hidden="true" />
    </button>
  )
}

export function SubjectsSummary({
  permissionKind,
  subjects,
  loading,
}: {
  permissionKind: AccessPermissionKind
  subjects: SelectableAccessSubject[]
  loading?: boolean
}) {
  const { t } = useTranslation('deployments')

  if (permissionKind !== 'specific') {
    return (
      <div className="flex min-h-8 items-center system-xs-regular text-text-tertiary">
        <span className="min-w-0">
          {t(`access.permission.${permissionKind}Desc`)}
        </span>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="flex min-h-8 items-center">
        <SkeletonRectangle className="h-4 w-36 animate-pulse" />
      </div>
    )
  }

  const groupCount = subjects.filter(subject => subject.subjectType === SubjectType.SUBJECT_TYPE_GROUP).length
  const memberCount = subjects.length - groupCount
  const countLabels = [
    ...(groupCount > 0 ? [t('access.members.groupCount', { count: groupCount })] : []),
    ...(memberCount > 0 ? [t('access.members.memberCount', { count: memberCount })] : []),
  ]

  return (
    <div className="flex min-h-8 min-w-0 items-center gap-1.5 system-xs-regular text-text-tertiary">
      <span className="i-ri-lock-line size-3.5 shrink-0" aria-hidden="true" />
      <span className="min-w-0 truncate">
        {countLabels.length > 0 ? countLabels.join(' · ') : t('access.permission.specificDesc')}
      </span>
    </div>
  )
}

export function DeploymentAccessControlDialog({
  initialDraft,
  subjectsLoading,
  saving,
  onClose,
  onSubmit,
}: {
  initialDraft: AccessControlDraft
  subjectsLoading?: boolean
  saving?: boolean
  onClose: () => void
  onSubmit: (kind: AccessPermissionKind, subjects: AccessSubjectSelectionValue) => void
}) {
  const draftKey = [
    initialDraft.currentMenu,
    initialDraft.specificGroups ? initialDraft.specificGroups.map(group => group.id).join(',') : 'no-groups',
    initialDraft.specificMembers ? initialDraft.specificMembers.map(member => member.id).join(',') : 'no-members',
  ].join(':')

  return (
    <AccessControlDraftProvider draftKey={draftKey} initialDraft={initialDraft}>
      <DeploymentAccessControlDialogBody
        subjectsLoading={subjectsLoading}
        saving={saving}
        onClose={onClose}
        onSubmit={onSubmit}
      />
    </AccessControlDraftProvider>
  )
}

function DeploymentAccessControlDialogBody({
  subjectsLoading,
  saving,
  onClose,
  onSubmit,
}: {
  subjectsLoading?: boolean
  saving?: boolean
  onClose: () => void
  onSubmit: (kind: AccessPermissionKind, subjects: AccessSubjectSelectionValue) => void
}) {
  const { t } = useTranslation('deployments')
  const currentMenu = useAccessControlStore(s => s.currentMenu)
  const specificGroups = useAccessControlStore(s => s.specificGroups)
  const specificMembers = useAccessControlStore(s => s.specificMembers)
  const specificSelected = currentMenu === AppAccessMode.SPECIFIC_GROUPS_MEMBERS
  const selectedSubjectCount = specificGroups.length + specificMembers.length
  const specificEmpty = specificSelected && selectedSubjectCount === 0
  const confirmDisabled = saving || (specificSelected && (subjectsLoading || specificEmpty))

  const handleConfirm = () => {
    if (confirmDisabled)
      return

    onSubmit(
      appAccessModeToPermissionKey(currentMenu),
      specificSelected
        ? { groups: specificGroups, members: specificMembers }
        : { groups: [], members: [] },
    )
  }

  return (
    <AccessControlDialog show onClose={onClose}>
      <AccessControlDialogContent
        title={t('access.permissions.editTitle')}
        description={t('access.permissions.editDescription')}
        hideExternal
        saving={saving}
        controlsDisabled={saving || subjectsLoading}
        confirmDisabled={confirmDisabled}
        specificGroupsOrMembersProps={{
          loading: subjectsLoading,
        }}
        onClose={onClose}
        onConfirm={handleConfirm}
      />
    </AccessControlDialog>
  )
}
