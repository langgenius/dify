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
import type { AccessSubjectSelectionValue } from '@/app/components/base/access-subject-selector/types'
import { toast } from '@langgenius/dify-ui/toast'
import { useMutation } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useSearchForWhiteListCandidates } from '@/service/access-control'
import { consoleQuery } from '@/service/client'
import { environmentName } from '../../../environment'
import {
  DetailTableCell,
  DetailTableRow,
} from '../../table'
import {
  accessControlSelectionFromSubjects,
  accessModeToPermissionKey,
  normalizeResolvedSubject,
  normalizeSubject,
  permissionKeyToAccessMode,
  policySubjects,
  selectedSubjectsFromPolicy,
  subjectsFromAccessControlSelection,
} from './access-policy'
import {
  DeploymentAccessControlDialog,
  PermissionSummaryButton,
  SubjectsSummary,
} from './permission-row-components'

const ACCESS_SUBJECT_LABEL_PAGE_SIZE = 100

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
  const setEnvironmentAccessPolicy = useMutation(consoleQuery.enterprise.accessService.putAccessPolicy.mutationOptions())
  const policy = summaryPolicy
  const policyKind = accessModeToPermissionKey(policy?.mode)
  const accessSubjectsQuery = useSearchForWhiteListCandidates({
    resultsPerPage: ACCESS_SUBJECT_LABEL_PAGE_SIZE,
  }, policyKind === 'specific')
  const accessSubjectCandidates = accessSubjectsQuery.data?.pages.flatMap(page => page.subjects ?? []) ?? []
  const accessSubjects = accessSubjectCandidates
    .map(normalizeSubject)
    .filter((subject): subject is SelectableAccessSubject => Boolean(subject)) ?? []
  const policySubjectFingerprint = policy?.subjects
    ?.map(subject => `${subject.subjectType ?? ''}:${subject.subjectId ?? ''}`)
    .join(',')
  const policyFingerprint = [
    policy?.mode ?? '',
    policySubjectFingerprint ?? '',
  ].join(':')
  const [draft, setDraft] = useState<{
    fingerprint?: string
    kind?: AccessPermissionKind
    subjects?: SelectableAccessSubject[]
  }>({})
  const [dialogOpen, setDialogOpen] = useState(false)
  const subjectLabelCandidates = [
    ...(draft.subjects ?? []),
    ...resolvedSubjects
      .map(normalizeResolvedSubject)
      .filter((subject): subject is SelectableAccessSubject => Boolean(subject)),
    ...accessSubjects,
  ]
  const hasDraft = draft.fingerprint === policyFingerprint
  const permissionKind = hasDraft && draft.kind ? draft.kind : policyKind
  const policySelectedSubjects = policyKind === 'specific' ? selectedSubjectsFromPolicy(policy, subjectLabelCandidates) : []
  const subjects = hasDraft && draft.subjects ? draft.subjects : policySelectedSubjects
  const subjectSelection = accessControlSelectionFromSubjects(subjects)
  const isSaving = setEnvironmentAccessPolicy.isPending
  const subjectsLoading = permissionKind === 'specific' && accessSubjectsQuery.isLoading
  const controlsDisabled = disabled || isSaving || subjectsLoading
  const envName = environmentName(environment)

  const persistPolicy = (
    nextKind: AccessPermissionKind,
    nextSubjects: SelectableAccessSubject[],
    options?: {
      onSuccess?: () => void
    },
  ) => {
    if (!environmentId)
      return false
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

  const handlePermissionSubmit = (nextKind: AccessPermissionKind, nextSelection: AccessSubjectSelectionValue) => {
    const normalizedSubjects = nextKind === 'specific' ? subjectsFromAccessControlSelection(nextSelection) : []
    setDraft({
      fingerprint: policyFingerprint,
      kind: nextKind,
      subjects: normalizedSubjects,
    })
    persistPolicy(nextKind, normalizedSubjects, {
      onSuccess: () => setDialogOpen(false),
    })
  }

  return (
    <DetailTableRow className="block h-auto pc:table-row">
      <DetailTableCell className="block h-auto max-w-none px-4 pt-3 pb-1 align-top pc:table-cell pc:p-3 pc:pr-2">
        <div className="system-2xs-medium-uppercase text-text-tertiary pc:hidden">
          {t('access.permissions.col.environment')}
        </div>
        <div className="mt-1 flex min-h-8 min-w-0 items-center pc:mt-0">
          <span className="min-w-0 truncate text-text-primary">
            {envName}
          </span>
        </div>
      </DetailTableCell>
      <DetailTableCell className="block h-auto max-w-none px-4 py-1 align-top pc:table-cell pc:p-3 pc:pr-2">
        <div className="mb-1 system-2xs-medium-uppercase text-text-tertiary pc:hidden">
          {t('access.permissions.col.permission')}
        </div>
        <PermissionSummaryButton
          value={permissionKind}
          disabled={controlsDisabled}
          loading={isSaving}
          environmentLabel={envName}
          onClick={() => setDialogOpen(true)}
        />
        {dialogOpen && (
          <DeploymentAccessControlDialog
            open={dialogOpen}
            value={permissionKind}
            subjects={subjectSelection}
            subjectsLoading={subjectsLoading}
            saving={isSaving}
            onClose={() => setDialogOpen(false)}
            onSubmit={handlePermissionSubmit}
          />
        )}
      </DetailTableCell>
      <DetailTableCell className="block h-auto max-w-none px-4 pt-1 pb-3 align-top pc:table-cell pc:p-3 pc:pr-2">
        <div className="mb-1 system-2xs-medium-uppercase text-text-tertiary pc:hidden">
          {t('access.permissions.col.subjects')}
        </div>
        <SubjectsSummary
          permissionKind={permissionKind}
          subjects={subjects}
          loading={subjectsLoading && subjects.length === 0}
        />
      </DetailTableCell>
    </DetailTableRow>
  )
}
