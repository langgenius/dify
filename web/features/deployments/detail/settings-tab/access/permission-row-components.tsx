'use client'

import type {
  AccessPermissionKind,
  SelectableAccessSubject,
} from './access-policy'
import type { AccessSubjectSelectionValue } from '@/app/components/app/app-access-control/access-subject-selector/types'
import type { AccessControlDraft } from '@/app/components/app/app-access-control/store'
import { AccessSubjectType } from '@dify/contracts/enterprise/types.gen'
import { cn } from '@langgenius/dify-ui/cn'
import { useTranslation } from 'react-i18next'
import { AccessControlDialog } from '@/app/components/app/app-access-control/access-control-dialog'
import { AccessControlDialogContent } from '@/app/components/app/app-access-control/access-control-dialog-content'
import { useAccessControlStore } from '@/app/components/app/app-access-control/store'
import { AccessControlDraftProvider } from '@/app/components/app/app-access-control/store-provider'
import { AccessMode as AppAccessMode } from '@/models/access-control'
import {
  appAccessModeToPermissionKey,
  permissionIcon,
} from './access-policy'

export function PermissionSummaryButton({
  value,
  subjects,
  disabled,
  loading,
  environmentLabel,
  onClick,
}: {
  value: AccessPermissionKind
  subjects?: SelectableAccessSubject[]
  disabled?: boolean
  loading?: boolean
  environmentLabel: string
  onClick: () => void
}) {
  const { t } = useTranslation('deployments')
  const groupCount = subjects?.filter(subject => subject.subjectType === AccessSubjectType.ACCESS_SUBJECT_TYPE_GROUP).length ?? 0
  const memberCount = (subjects?.length ?? 0) - groupCount
  const countLabels = [
    ...(groupCount > 0 ? [t('access.members.groupCount', { count: groupCount })] : []),
    ...(memberCount > 0 ? [t('access.members.memberCount', { count: memberCount })] : []),
  ]
  const specificSubjectLabel = value === 'specific'
    ? subjects && subjects.length > 0
      ? countLabels.join(' · ')
      : t('access.permission.specificDesc')
    : undefined
  const IconClassName = loading ? 'i-ri-loader-2-line animate-spin motion-reduce:animate-none' : permissionIcon[value]

  return (
    <button
      type="button"
      disabled={disabled}
      aria-label={t('access.permissions.editAriaLabel', { environment: environmentLabel })}
      onClick={onClick}
      className={cn(
        'flex h-9 w-full min-w-0 cursor-pointer items-center gap-x-0.5 rounded-lg bg-components-input-bg-normal py-1 pr-2 pl-2.5 outline-hidden hover:bg-state-base-hover-alt focus-visible:bg-state-base-hover-alt focus-visible:ring-1 focus-visible:ring-components-input-border-active focus-visible:ring-inset',
        disabled && 'cursor-not-allowed opacity-50 hover:bg-components-input-bg-normal',
      )}
    >
      <div className="flex min-w-0 grow items-center gap-x-1.5 pr-1">
        <span
          className={cn(IconClassName, 'size-4 shrink-0 text-text-secondary')}
          aria-hidden="true"
        />
        <p className="min-w-0 truncate text-left system-sm-medium text-text-secondary">
          {t(`access.permission.${value}`)}
        </p>
      </div>
      {specificSubjectLabel && (
        <p className="shrink-0 system-xs-regular text-text-tertiary">
          {specificSubjectLabel}
        </p>
      )}
      <div className="flex size-4 shrink-0 items-center justify-center">
        <span className="i-ri-arrow-right-s-line size-4 text-text-quaternary" aria-hidden="true" />
      </div>
    </button>
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
