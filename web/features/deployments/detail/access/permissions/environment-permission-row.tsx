'use client'

import type { AccessPolicy, Environment, Subject } from '@dify/contracts/enterprise/types.gen'
import type { AccessPermissionKind, SelectableAccessSubject } from './access-policy'
import { toast } from '@langgenius/dify-ui/toast'
import { useMutation } from '@tanstack/react-query'
import { useAtomValue } from 'jotai'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { consoleQuery } from '@/service/client'
import { deploymentRouteAppInstanceIdAtom } from '../../../route-state'
import { DeploymentAccessControlDialog } from './access-control-dialog'
import {
  accessModeToPermissionKey,
  normalizeResolvedSubject,
  permissionKeyToAccessMode,
  policySubjects,
  selectedSubjectsFromPolicy,
} from './access-policy'
import { PermissionSummaryButton } from './permission-summary-button'

type AccessPermissionDraft = {
  fingerprint: string
  kind: AccessPermissionKind
  subjects: SelectableAccessSubject[]
}

type EnvironmentPermissionRowProps = {
  disabled?: boolean
  environment: Environment
  summaryPolicy?: AccessPolicy
  resolvedSubjects?: Subject[]
}

export function EnvironmentPermissionRow({
  disabled,
  environment,
  summaryPolicy,
  resolvedSubjects = [],
}: EnvironmentPermissionRowProps) {
  const { t } = useTranslation('deployments')
  const appInstanceId = useAtomValue(deploymentRouteAppInstanceIdAtom)
  const environmentId = environment.id
  const setEnvironmentAccessPolicy = useMutation(
    consoleQuery.enterprise.accessService.updateAccessPolicy.mutationOptions(),
  )
  const policy = summaryPolicy
  const policyKind = accessModeToPermissionKey(policy?.mode)
  const policyFingerprint = policy
    ? `${policy.mode}:${policy.subjects.map((subject) => `${subject.subjectType}:${subject.subjectId}`).join(',')}`
    : 'no-policy'
  const [draft, setDraft] = useState<AccessPermissionDraft>()
  const [dialogOpen, setDialogOpen] = useState(false)
  const subjectLabelCandidates = [
    ...(draft?.subjects ?? []),
    ...resolvedSubjects.flatMap((subject) => {
      const normalizedSubject = normalizeResolvedSubject(subject)
      return normalizedSubject ? [normalizedSubject] : []
    }),
  ]
  const hasDraft = draft?.fingerprint === policyFingerprint
  const permissionKind = hasDraft && draft ? draft.kind : policyKind
  const policySelectedSubjects =
    policyKind === 'specific' ? selectedSubjectsFromPolicy(policy, subjectLabelCandidates) : []
  const subjects = hasDraft && draft ? draft.subjects : policySelectedSubjects
  const isSaving = setEnvironmentAccessPolicy.isPending
  const controlsDisabled = disabled || isSaving || !appInstanceId
  const envName = environment.displayName

  const persistPolicy = (
    nextKind: AccessPermissionKind,
    nextSubjects: SelectableAccessSubject[],
    options?: {
      onSuccess?: () => void
    },
  ) => {
    if (!appInstanceId) return false

    if (nextKind === 'specific' && nextSubjects.length === 0) return false

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
          toast.error(t(($) => $['access.permission.updateFailed']))
        },
      },
    )
    return true
  }

  const handlePermissionSubmit = (
    nextKind: AccessPermissionKind,
    normalizedSubjects: SelectableAccessSubject[],
  ) => {
    persistPolicy(nextKind, normalizedSubjects, {
      onSuccess: () => {
        setDraft({
          fingerprint: policyFingerprint,
          kind: nextKind,
          subjects: normalizedSubjects,
        })
        setDialogOpen(false)
      },
    })
  }

  return (
    <div className="flex min-w-0 flex-col gap-2 border-b border-divider-subtle py-4 first:pt-0 last:border-b-0 last:pb-0">
      <div className="flex min-w-0 items-center">
        <span className="min-w-0 truncate system-sm-regular text-text-primary">{envName}</span>
      </div>
      <PermissionSummaryButton
        value={permissionKind}
        subjects={subjects}
        disabled={controlsDisabled}
        loading={isSaving}
        environmentLabel={envName}
        onClick={() => setDialogOpen(true)}
      />
      <DeploymentAccessControlDialog
        open={dialogOpen}
        initialKind={permissionKind}
        initialSubjects={subjects}
        saving={isSaving}
        onClose={() => setDialogOpen(false)}
        onSubmit={handlePermissionSubmit}
      />
    </div>
  )
}
