'use client'

import type {
  AccessPolicy,
  AccessSubject,
  Environment,
  Subject,
} from '@dify/contracts/enterprise/types.gen'
import type { AccessSubjectSelectionValue } from '@/app/components/base/access-subject-selector'
import type {
  AccessControlAccount,
  AccessControlGroup,
  Subject as AccessControlSubject,
  SubjectAccount as AccessControlSubjectAccount,
  SubjectGroup as AccessControlSubjectGroup,
} from '@/models/access-control'
import { cn } from '@langgenius/dify-ui/cn'
import { toast } from '@langgenius/dify-ui/toast'
import { useMutation } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import AccessControlDialog from '@/app/components/app/app-access-control/access-control-dialog'
import { AccessControlDialogContent } from '@/app/components/app/app-access-control/access-control-dialog-content'
import { SkeletonRectangle } from '@/app/components/base/skeleton'
import useAccessControlStore from '@/context/access-control-store'
import { SubjectType as AccessControlSubjectType, AccessMode as AppAccessMode } from '@/models/access-control'
import { useSearchForWhiteListCandidates } from '@/service/access-control'
import { consoleQuery } from '@/service/client'
import { environmentName } from '../../../environment'
import {
  DetailTableCell,
  DetailTableRow,
} from '../../table'

type AccessPermissionKind = 'organization' | 'specific' | 'anyone'
type AccessPolicyMode = NonNullable<AccessPolicy['mode']>
type AccessSubjectType = NonNullable<AccessSubject['subjectType']>

const ACCESS_MODE_PUBLIC = 'ACCESS_MODE_PUBLIC' satisfies AccessPolicyMode
const ACCESS_MODE_PRIVATE = 'ACCESS_MODE_PRIVATE' satisfies AccessPolicyMode
const ACCESS_MODE_PRIVATE_ALL = 'ACCESS_MODE_PRIVATE_ALL' satisfies AccessPolicyMode
const SUBJECT_TYPE_ACCOUNT = 'SUBJECT_TYPE_ACCOUNT' satisfies AccessSubjectType
const SUBJECT_TYPE_GROUP = 'SUBJECT_TYPE_GROUP' satisfies AccessSubjectType
const ACCESS_SUBJECT_LABEL_PAGE_SIZE = 100

function accessModeToPermissionKey(mode?: AccessPolicy['mode']): AccessPermissionKind {
  if (mode === ACCESS_MODE_PRIVATE)
    return 'specific'
  if (mode === ACCESS_MODE_PUBLIC)
    return 'anyone'
  return 'organization'
}

function permissionKeyToAccessMode(key: AccessPermissionKind): AccessPolicyMode {
  if (key === 'organization')
    return ACCESS_MODE_PRIVATE_ALL
  if (key === 'specific')
    return ACCESS_MODE_PRIVATE
  return ACCESS_MODE_PUBLIC
}

function permissionKeyToAppAccessMode(key: AccessPermissionKind): AppAccessMode {
  if (key === 'organization')
    return AppAccessMode.ORGANIZATION
  if (key === 'specific')
    return AppAccessMode.SPECIFIC_GROUPS_MEMBERS
  return AppAccessMode.PUBLIC
}

function appAccessModeToPermissionKey(mode: AppAccessMode): AccessPermissionKind {
  if (mode === AppAccessMode.SPECIFIC_GROUPS_MEMBERS)
    return 'specific'
  if (mode === AppAccessMode.PUBLIC)
    return 'anyone'
  return 'organization'
}

const permissionIcon: Record<AccessPermissionKind, string> = {
  organization: 'i-ri-team-line',
  specific: 'i-ri-lock-line',
  anyone: 'i-ri-global-line',
}

type SelectableAccessSubject = {
  id: string
  subjectType: AccessSubjectType
  name?: string
  memberCount?: number
}

function normalizeSubject(subject: AccessControlSubject): SelectableAccessSubject | undefined {
  if (subject.subjectType === AccessControlSubjectType.GROUP) {
    const groupSubject = subject as AccessControlSubjectGroup
    const id = groupSubject.subjectId || groupSubject.groupData.id
    if (!id)
      return undefined

    return {
      id,
      subjectType: SUBJECT_TYPE_GROUP,
      name: groupSubject.groupData.name,
      memberCount: groupSubject.groupData.groupSize,
    }
  }

  const accountSubject = subject as AccessControlSubjectAccount
  const id = accountSubject.subjectId || accountSubject.accountData.id
  if (!id)
    return undefined

  return {
    id,
    subjectType: SUBJECT_TYPE_ACCOUNT,
    name: accountSubject.accountData.name || accountSubject.accountData.email,
  }
}

function normalizeResolvedSubject(subject: Subject): SelectableAccessSubject | undefined {
  if (subject.subjectType === SUBJECT_TYPE_GROUP) {
    const id = subject.subjectId || subject.groupData?.id
    if (!id)
      return undefined

    return {
      id,
      subjectType: SUBJECT_TYPE_GROUP,
      name: subject.groupData?.name,
      memberCount: subject.groupData?.groupSize,
    }
  }

  if (subject.subjectType === SUBJECT_TYPE_ACCOUNT) {
    const id = subject.subjectId || subject.accountData?.id
    if (!id)
      return undefined

    return {
      id,
      subjectType: SUBJECT_TYPE_ACCOUNT,
      name: subject.accountData?.name || subject.accountData?.email,
    }
  }

  return undefined
}

function getSubjectLabel(subject: SelectableAccessSubject) {
  return subject.name || subject.id
}

function policySubjects(subjects: SelectableAccessSubject[]): AccessSubject[] {
  return subjects.map(subject => ({
    subjectId: subject.id,
    subjectType: subject.subjectType,
  }))
}

function selectedSubjectsFromPolicy(policy?: AccessPolicy, labelSubjects: SelectableAccessSubject[] = []) {
  return policy?.subjects
    ?.map((subject): SelectableAccessSubject | undefined => {
      if (!subject.subjectId || !subject.subjectType)
        return undefined
      const matchedSubject = labelSubjects.find(labelSubject =>
        labelSubject.id === subject.subjectId && labelSubject.subjectType === subject.subjectType,
      )
      return {
        id: subject.subjectId,
        subjectType: subject.subjectType,
        name: matchedSubject?.name,
        memberCount: matchedSubject?.memberCount,
      }
    })
    .filter((subject): subject is SelectableAccessSubject => Boolean(subject)) ?? []
}

function selectableSubjectToGroup(subject: SelectableAccessSubject): AccessControlGroup {
  return {
    id: subject.id,
    name: getSubjectLabel(subject),
    groupSize: subject.memberCount ?? 0,
  }
}

function selectableSubjectToAccount(subject: SelectableAccessSubject): AccessControlAccount {
  const label = getSubjectLabel(subject)

  return {
    id: subject.id,
    name: label,
    email: label,
    avatar: '',
    avatarUrl: '',
  }
}

function accessControlSelectionFromSubjects(subjects: SelectableAccessSubject[]): AccessSubjectSelectionValue {
  return {
    groups: subjects
      .filter(subject => subject.subjectType === SUBJECT_TYPE_GROUP)
      .map(selectableSubjectToGroup),
    members: subjects
      .filter(subject => subject.subjectType === SUBJECT_TYPE_ACCOUNT)
      .map(selectableSubjectToAccount),
  }
}

function subjectsFromAccessControlSelection(value: AccessSubjectSelectionValue): SelectableAccessSubject[] {
  return [
    ...value.groups.map((group): SelectableAccessSubject => ({
      id: group.id,
      subjectType: SUBJECT_TYPE_GROUP,
      name: group.name,
      memberCount: group.groupSize,
    })),
    ...value.members.map((member): SelectableAccessSubject => ({
      id: member.id,
      subjectType: SUBJECT_TYPE_ACCOUNT,
      name: member.name || member.email,
    })),
  ]
}

function PermissionSummaryButton({
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

function SubjectsSummary({
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

  const groupCount = subjects.filter(subject => subject.subjectType === SUBJECT_TYPE_GROUP).length
  const memberCount = subjects.length - groupCount
  const countLabels = [
    groupCount > 0 ? t('access.members.groupCount', { count: groupCount }) : undefined,
    memberCount > 0 ? t('access.members.memberCount', { count: memberCount }) : undefined,
  ].filter((label): label is string => Boolean(label))

  return (
    <div className="flex min-h-8 min-w-0 items-center gap-1.5 system-xs-regular text-text-tertiary">
      <span className="i-ri-lock-line size-3.5 shrink-0" aria-hidden="true" />
      <span className="min-w-0 truncate">
        {countLabels.length > 0 ? countLabels.join(' · ') : t('access.permission.specificDesc')}
      </span>
    </div>
  )
}

function DeploymentAccessControlDialog({
  open,
  value,
  subjects,
  subjectsLoading,
  saving,
  onClose,
  onSubmit,
}: {
  open: boolean
  value: AccessPermissionKind
  subjects: AccessSubjectSelectionValue
  subjectsLoading?: boolean
  saving?: boolean
  onClose: () => void
  onSubmit: (kind: AccessPermissionKind, subjects: AccessSubjectSelectionValue) => void
}) {
  const { t } = useTranslation('deployments')
  const currentMenu = useAccessControlStore(s => s.currentMenu)
  const setCurrentMenu = useAccessControlStore(s => s.setCurrentMenu)
  const specificGroups = useAccessControlStore(s => s.specificGroups)
  const setSpecificGroups = useAccessControlStore(s => s.setSpecificGroups)
  const specificMembers = useAccessControlStore(s => s.specificMembers)
  const setSpecificMembers = useAccessControlStore(s => s.setSpecificMembers)
  const setSelectedGroupsForBreadcrumb = useAccessControlStore(s => s.setSelectedGroupsForBreadcrumb)
  const specificSelected = currentMenu === AppAccessMode.SPECIFIC_GROUPS_MEMBERS
  const selectedSubjectCount = specificGroups.length + specificMembers.length
  const specificEmpty = specificSelected && selectedSubjectCount === 0
  const confirmDisabled = saving || (specificSelected && (subjectsLoading || specificEmpty))

  useEffect(() => {
    if (!open)
      return

    setCurrentMenu(permissionKeyToAppAccessMode(value))
    setSpecificGroups(subjects.groups)
    setSpecificMembers(subjects.members)
    setSelectedGroupsForBreadcrumb([])
  }, [
    open,
    setCurrentMenu,
    setSelectedGroupsForBreadcrumb,
    setSpecificGroups,
    setSpecificMembers,
    subjects.groups,
    subjects.members,
    value,
  ])

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
    <AccessControlDialog show={open} onClose={onClose}>
      <AccessControlDialogContent
        title={t('access.permissions.editTitle')}
        description={t('access.permissions.editDescription')}
        hideExternal
        saving={saving}
        confirmDisabled={confirmDisabled}
        specificGroupsOrMembersProps={{
          loadSubjects: false,
          loading: subjectsLoading,
        }}
        onClose={onClose}
        onConfirm={handleConfirm}
      />
    </AccessControlDialog>
  )
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
