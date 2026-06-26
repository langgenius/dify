'use client'

import type {
  AccessPermissionKind,
} from './access-policy'
import type { AccessSubjectSelectionValue } from './access-subject-selector/types'
import type { AccessControlDraft } from './store'
import { useTranslation } from 'react-i18next'
import { AccessMode as AppAccessMode } from '@/models/access-control'
import { AccessControlDialog } from './access-control-dialog'
import { AccessControlDialogContent } from './access-control-dialog-content'
import {
  appAccessModeToPermissionKey,
} from './access-policy'
import { useAccessControlStore } from './store'
import { AccessControlDraftProvider } from './store-provider'

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
