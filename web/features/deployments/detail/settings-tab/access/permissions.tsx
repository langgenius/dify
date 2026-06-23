'use client'

import type {
  AccessPolicy,
  Environment,
  Subject,
} from '@dify/contracts/enterprise/types.gen'
import type {
  AccessPermissionKind,
  SelectableAccessSubject,
} from './access-policy'
import type { AccessSubjectSelectionValue } from '@/app/components/app/app-access-control/access-subject-selector/types'
import { toast } from '@langgenius/dify-ui/toast'
import { useAtomValue } from 'jotai'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  accessControlSelectionFromSubjects,
  accessModeToPermissionKey,
  normalizeResolvedSubject,
  permissionKeyToAccessMode,
  permissionKeyToAppAccessMode,
  policySubjects,
  selectedSubjectsFromPolicy,
  subjectsFromAccessControlSelection,
} from './access-policy'
import {
  DeploymentAccessControlDialog,
  PermissionSummaryButton,
} from './permission-row-components'
import { createUpdateAccessPolicyMutationAtom } from './state'

type AccessPermissionDraft = {
  fingerprint: string
  kind: AccessPermissionKind
  subjects: SelectableAccessSubject[]
}

type EnvironmentPermissionRowProps = {
  appInstanceId: string
  disabled?: boolean
  environment: Environment
  summaryPolicy?: AccessPolicy
  resolvedSubjects?: Subject[]
}

export function EnvironmentPermissionRow({
  appInstanceId,
  disabled,
  environment,
  summaryPolicy,
  resolvedSubjects = [],
}: EnvironmentPermissionRowProps) {
  const { t } = useTranslation('deployments')
  const environmentId = environment.id
  const updateAccessPolicyMutationAtom = useMemo(() => createUpdateAccessPolicyMutationAtom(), [])
  const setEnvironmentAccessPolicy = useAtomValue(updateAccessPolicyMutationAtom)
  const policy = summaryPolicy
  const policyKind = accessModeToPermissionKey(policy?.mode)
  const policyFingerprint = policy
    ? `${policy.mode}:${policy.subjects.map(subject => `${subject.subjectType}:${subject.subjectId}`).join(',')}`
    : 'no-policy'
  const [draft, setDraft] = useState<AccessPermissionDraft>()
  const subjectLabelCandidates = [
    ...(draft?.subjects ?? []),
    ...resolvedSubjects
      .flatMap((subject) => {
        const normalizedSubject = normalizeResolvedSubject(subject)
        return normalizedSubject ? [normalizedSubject] : []
      }),
  ]
  const hasDraft = draft?.fingerprint === policyFingerprint
  const permissionKind = hasDraft && draft ? draft.kind : policyKind
  const policySelectedSubjects = policyKind === 'specific' ? selectedSubjectsFromPolicy(policy, subjectLabelCandidates) : []
  const subjects = hasDraft && draft ? draft.subjects : policySelectedSubjects
  const subjectSelection = accessControlSelectionFromSubjects(subjects)
  const isSaving = setEnvironmentAccessPolicy.isPending
  const controlsDisabled = disabled || isSaving
  const envName = environment.displayName

  const persistPolicy = (
    nextKind: AccessPermissionKind,
    nextSubjects: SelectableAccessSubject[],
    options?: {
      onSuccess?: () => void
    },
  ) => {
    if (nextKind === 'specific' && nextSubjects.length === 0)
      return false

    setEnvironmentAccessPolicy.mutate(
      {
        params: {
          appInstanceId,
          environmentId,
        },
        body: {
          appInstanceId,
          environmentId,
          mode: permissionKeyToAccessMode(nextKind),
          subjects: nextKind === 'specific' ? policySubjects(nextSubjects) : [],
        },
      },
      {
        onSuccess: options?.onSuccess,
        onError: () => {
          toast.error(t('access.permission.updateFailed'))
        },
      },
    )
    return true
  }

  const handlePermissionSubmit = (
    nextKind: AccessPermissionKind,
    nextSelection: AccessSubjectSelectionValue,
    options?: {
      onSuccess?: () => void
    },
  ) => {
    const normalizedSubjects = nextKind === 'specific' ? subjectsFromAccessControlSelection(nextSelection) : []
    persistPolicy(nextKind, normalizedSubjects, {
      onSuccess: () => {
        setDraft({
          fingerprint: policyFingerprint,
          kind: nextKind,
          subjects: normalizedSubjects,
        })
        options?.onSuccess?.()
      },
    })
  }

  return (
    <div className="flex min-w-0 flex-col gap-2 border-b border-divider-subtle py-4 first:pt-0 last:border-b-0 last:pb-0">
      <div className="flex min-w-0 items-center">
        <span className="min-w-0 truncate system-sm-regular text-text-primary">
          {envName}
        </span>
      </div>
      <EnvironmentPermissionEditor
        permissionKind={permissionKind}
        subjectSelection={subjectSelection}
        subjects={subjects}
        disabled={controlsDisabled}
        environmentLabel={envName}
        saving={isSaving}
        onSubmit={handlePermissionSubmit}
      />
    </div>
  )
}

function EnvironmentPermissionEditor({
  permissionKind,
  subjectSelection,
  subjects,
  disabled,
  environmentLabel,
  saving,
  onSubmit,
}: {
  permissionKind: AccessPermissionKind
  subjectSelection: AccessSubjectSelectionValue
  subjects: SelectableAccessSubject[]
  disabled?: boolean
  environmentLabel: string
  saving?: boolean
  onSubmit: (
    nextKind: AccessPermissionKind,
    nextSelection: AccessSubjectSelectionValue,
    options?: { onSuccess?: () => void },
  ) => void
}) {
  const [dialogOpen, setDialogOpen] = useState(false)

  const handleSubmit = (nextKind: AccessPermissionKind, nextSelection: AccessSubjectSelectionValue) => {
    onSubmit(nextKind, nextSelection, {
      onSuccess: () => setDialogOpen(false),
    })
  }

  return (
    <>
      <PermissionSummaryButton
        value={permissionKind}
        subjects={subjects}
        disabled={disabled}
        loading={saving}
        environmentLabel={environmentLabel}
        onClick={() => setDialogOpen(true)}
      />
      {dialogOpen && (
        <DeploymentAccessControlDialog
          initialDraft={{
            currentMenu: permissionKeyToAppAccessMode(permissionKind),
            specificGroups: subjectSelection.groups,
            specificMembers: subjectSelection.members,
            selectedGroupsForBreadcrumb: [],
          }}
          saving={saving}
          onClose={() => setDialogOpen(false)}
          onSubmit={handleSubmit}
        />
      )}
    </>
  )
}
