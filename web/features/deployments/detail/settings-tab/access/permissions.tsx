'use client'

import type {
  AccessSubject,
  AppDeployEnvironment,
  EnvironmentAccessRow,
  Subject,
} from '@dify/contracts/enterprise/types.gen'
import { cn } from '@langgenius/dify-ui/cn'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@langgenius/dify-ui/dropdown-menu'
import { Popover, PopoverContent, PopoverTrigger } from '@langgenius/dify-ui/popover'
import { toast } from '@langgenius/dify-ui/toast'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useDebounce } from 'ahooks'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import Input from '@/app/components/base/input'
import { SkeletonRectangle, SkeletonRow } from '@/app/components/base/skeleton'
import { consoleQuery } from '@/service/client'
import { environmentName } from '../../../environment'

type AccessPermissionKind = 'organization' | 'specific' | 'anyone'

function accessModeToPermissionKey(mode?: string): AccessPermissionKind {
  const normalized = mode?.toLowerCase() ?? ''
  if (normalized === 'private')
    return 'specific'
  if (normalized === 'public')
    return 'anyone'
  return 'organization'
}

function permissionKeyToAccessMode(key: AccessPermissionKind) {
  if (key === 'organization')
    return 'private_all'
  if (key === 'specific')
    return 'private'
  return 'public'
}

const permissionIcon: Record<AccessPermissionKind, string> = {
  organization: 'i-ri-team-line',
  specific: 'i-ri-lock-line',
  anyone: 'i-ri-global-line',
}

const permissionOrder: AccessPermissionKind[] = ['organization', 'specific', 'anyone']

function PermissionPicker({ value, disabled, onChange }: {
  value: AccessPermissionKind
  disabled?: boolean
  onChange: (kind: AccessPermissionKind) => void
}) {
  const { t } = useTranslation('deployments')
  const icon = permissionIcon[value]
  const label = t(`access.permission.${value}`)

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        disabled={disabled}
        className={cn(
          'inline-flex h-8 min-w-55 items-center gap-2 rounded-lg border border-components-input-border-active bg-components-input-bg-normal px-2.5 system-sm-regular text-text-secondary hover:bg-state-base-hover',
          disabled && 'opacity-50',
        )}
      >
        <span className={cn(icon, 'size-4 shrink-0 text-text-tertiary')} />
        <span className="flex-1 truncate text-left">{label}</span>
        <span className="i-ri-arrow-down-s-line size-4 shrink-0 text-text-tertiary" />
      </DropdownMenuTrigger>
      <DropdownMenuContent placement="bottom-start" popupClassName="w-85 p-1">
        {permissionOrder.map((kind) => {
          const itemIcon = permissionIcon[kind]
          const isSelected = kind === value
          return (
            <DropdownMenuItem
              key={kind}
              onClick={() => onChange(kind)}
              className="mx-0 h-auto items-start gap-3 rounded-lg px-2.5 py-2"
            >
              <span className={cn(itemIcon, 'mt-0.5 size-4 shrink-0 text-text-tertiary')} />
              <div className="flex min-w-0 flex-1 flex-col">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="truncate system-sm-medium text-text-primary">
                    {t(`access.permission.${kind}`)}
                  </span>
                </div>
                <span className="system-xs-regular text-text-tertiary">
                  {t(`access.permission.${kind}Desc`)}
                </span>
              </div>
              {isSelected && (
                <span className="mt-0.5 i-ri-check-line size-4 shrink-0 text-text-accent" />
              )}
            </DropdownMenuItem>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

type SelectableAccessSubject = {
  id: string
  subjectType: string
  name?: string
  memberCount?: number
}

function normalizeSubject(subject: Subject): SelectableAccessSubject | undefined {
  const id = subject.subjectId || subject.accountData?.id || subject.groupData?.id
  const subjectType = subject.subjectType || (subject.groupData ? 'group' : 'account')
  if (!id || !subjectType)
    return undefined

  return {
    id,
    subjectType,
    name: subject.accountData?.name || subject.accountData?.email || subject.groupData?.name || id,
    memberCount: subject.groupData?.groupSize,
  }
}

function subjectKey(subject: Pick<SelectableAccessSubject, 'id' | 'subjectType'>) {
  return `${subject.subjectType}:${subject.id}`
}

const SUBJECT_PICKER_SKELETON_KEYS = ['first-subject', 'second-subject', 'third-subject']

function policySubjects(subjects: SelectableAccessSubject[]): AccessSubject[] {
  return subjects.map(subject => ({
    subjectId: subject.id,
    subjectType: subject.subjectType,
  }))
}

function selectedSubjectsFromPolicy(policy?: EnvironmentAccessRow) {
  return policy?.subjects
    ?.map(normalizeSubject)
    .filter((subject): subject is SelectableAccessSubject => Boolean(subject)) ?? []
}

function SubjectPill({ subject, disabled, onRemove }: {
  subject: SelectableAccessSubject
  disabled?: boolean
  onRemove: () => void
}) {
  const { t } = useTranslation('deployments')
  const isGroup = subject.subjectType === 'group'

  return (
    <div className="inline-flex max-w-full items-center gap-1 rounded-full border border-divider-subtle bg-components-badge-white-to-dark px-2 py-1">
      <span className={cn(isGroup ? 'i-ri-group-line' : 'i-ri-user-line', 'size-3.5 shrink-0 text-text-tertiary')} />
      <span className="truncate system-xs-medium text-text-secondary">{subject.name || subject.id}</span>
      {isGroup && subject.memberCount != null && (
        <span className="system-2xs-regular text-text-tertiary">{subject.memberCount}</span>
      )}
      <button
        type="button"
        disabled={disabled}
        onClick={onRemove}
        aria-label={t('operation.remove', { ns: 'common' })}
        className={cn(
          'flex size-4 shrink-0 items-center justify-center rounded-full text-text-quaternary hover:text-text-secondary',
          disabled && 'cursor-not-allowed opacity-40',
        )}
      >
        <span className="i-ri-close-circle-fill size-3.5" />
      </button>
    </div>
  )
}

type SubjectPickerProps = {
  disabled?: boolean
  selectedSubjects: SelectableAccessSubject[]
  onChange: (subjects: SelectableAccessSubject[]) => void
}

function SubjectPicker({
  disabled,
  selectedSubjects,
  onChange,
}: SubjectPickerProps) {
  const { t } = useTranslation('deployments')
  const [open, setOpen] = useState(false)
  const [keyword, setKeyword] = useState('')
  const debouncedKeyword = useDebounce(keyword, { wait: 300 })
  const selectedKeys = new Set(selectedSubjects.map(subjectKey))
  const subjectsQuery = useQuery(consoleQuery.enterprise.accessSubjectService.listAccessSubjects.queryOptions({
    input: {
      query: {
        keyword: debouncedKeyword.trim() || undefined,
        pageNumber: 1,
        resultsPerPage: 50,
      },
    },
    enabled: open,
  }))
  const subjects = subjectsQuery.data?.subjects
    ?.map(normalizeSubject)
    .filter((subject): subject is SelectableAccessSubject => Boolean(subject)) ?? []

  const toggleSubject = (subject: SelectableAccessSubject) => {
    const key = subjectKey(subject)
    if (selectedKeys.has(key)) {
      if (selectedSubjects.length <= 1)
        return
      onChange(selectedSubjects.filter(item => subjectKey(item) !== key))
      return
    }
    onChange([...selectedSubjects, subject])
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={(
          <button
            type="button"
            disabled={disabled}
            className={cn(
              'inline-flex h-8 items-center gap-1.5 rounded-lg border border-components-button-secondary-border bg-components-button-secondary-bg px-3 system-sm-medium text-components-button-secondary-text hover:bg-components-button-secondary-bg-hover',
              disabled && 'cursor-not-allowed opacity-50',
            )}
          >
            <span className="i-ri-add-line size-3.5" />
            {t('access.members.pickPlaceholder')}
          </button>
        )}
      />
      {open && (
        <PopoverContent placement="bottom-start" sideOffset={4} popupClassName="w-90 p-0">
          <div className="flex max-h-105 flex-col overflow-hidden rounded-xl border border-components-panel-border bg-components-panel-bg shadow-lg">
            <div className="border-b border-divider-subtle p-2">
              <Input
                showLeftIcon
                value={keyword}
                onChange={e => setKeyword(e.target.value)}
                placeholder={t('access.members.searchPlaceholder')}
                className="h-8"
              />
            </div>
            <div className="min-h-10 overflow-y-auto p-1">
              {subjectsQuery.isLoading
                ? (
                    <div className="flex flex-col gap-2 px-3 py-3">
                      {SUBJECT_PICKER_SKELETON_KEYS.map(key => (
                        <SkeletonRow key={key} className="h-6">
                          <SkeletonRectangle className="h-3 w-full animate-pulse" />
                        </SkeletonRow>
                      ))}
                    </div>
                  )
                : subjects.length === 0
                  ? (
                      <div className="px-3 py-5 text-center system-xs-regular text-text-tertiary">
                        {t('access.members.empty')}
                      </div>
                    )
                  : subjects.map((subject) => {
                      const isSelected = selectedKeys.has(subjectKey(subject))
                      const isGroup = subject.subjectType === 'group'
                      return (
                        <button
                          key={subjectKey(subject)}
                          type="button"
                          onClick={() => toggleSubject(subject)}
                          className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left hover:bg-state-base-hover"
                        >
                          <span className={cn(isGroup ? 'i-ri-group-line' : 'i-ri-user-line', 'size-4 shrink-0 text-text-tertiary')} />
                          <span className="min-w-0 flex-1 truncate system-sm-medium text-text-secondary">
                            {subject.name || subject.id}
                          </span>
                          {isGroup && subject.memberCount != null && (
                            <span className="system-xs-regular text-text-tertiary">
                              {t('access.members.memberCount', { count: subject.memberCount })}
                            </span>
                          )}
                          {isSelected && (
                            <span className="i-ri-check-line size-4 shrink-0 text-text-accent" />
                          )}
                        </button>
                      )
                    })}
            </div>
          </div>
        </PopoverContent>
      )}
    </Popover>
  )
}

type EnvironmentPermissionRowProps = {
  appInstanceId: string
  environment: AppDeployEnvironment
  summaryPolicy?: EnvironmentAccessRow
}

export function EnvironmentPermissionRow({
  appInstanceId,
  environment,
  summaryPolicy,
}: EnvironmentPermissionRowProps) {
  const { t } = useTranslation('deployments')
  const environmentId = environment.id
  const setEnvironmentAccessPolicy = useMutation(consoleQuery.enterprise.appDeployAccessService.updateEnvironmentAccessPolicy.mutationOptions())
  const policyKind = accessModeToPermissionKey(summaryPolicy?.accessMode)
  const policySubjectFingerprint = summaryPolicy?.subjects
    ?.map(subject => `${subject.subjectType ?? ''}:${subject.subjectId ?? subject.accountData?.id ?? subject.groupData?.id ?? ''}`)
    .join(',')
  const policyFingerprint = [
    summaryPolicy?.accessMode ?? '',
    policySubjectFingerprint ?? '',
  ].join(':')
  const policySelectedSubjects = policyKind === 'specific' ? selectedSubjectsFromPolicy(summaryPolicy) : []
  const [draft, setDraft] = useState<{
    fingerprint?: string
    kind?: AccessPermissionKind
    subjects?: SelectableAccessSubject[]
  }>({})
  const hasDraft = draft.fingerprint === policyFingerprint
  const permissionKind = hasDraft && draft.kind ? draft.kind : policyKind
  const subjects = hasDraft && draft.subjects ? draft.subjects : policySelectedSubjects
  const isSaving = setEnvironmentAccessPolicy.isPending
  const controlsDisabled = isSaving

  const persistPolicy = (nextKind: AccessPermissionKind, nextSubjects: SelectableAccessSubject[]) => {
    if (!environmentId)
      return
    if (nextKind === 'specific' && nextSubjects.length === 0)
      return

    setEnvironmentAccessPolicy.mutate(
      {
        params: {
          appInstanceId,
          environmentId,
        },
        body: {
          appInstanceId,
          environmentId,
          accessMode: permissionKeyToAccessMode(nextKind),
          subjects: nextKind === 'specific' ? policySubjects(nextSubjects) : [],
        },
      },
      {
        onSuccess: () => {
          setDraft({})
        },
        onError: () => {
          toast.error(t('access.permission.updateFailed'))
        },
      },
    )
  }

  const handlePermissionChange = (nextKind: AccessPermissionKind) => {
    setDraft({
      fingerprint: policyFingerprint,
      kind: nextKind,
      subjects: nextKind === 'specific' ? subjects : [],
    })
    if (nextKind === 'specific') {
      persistPolicy(nextKind, subjects)
      return
    }
    persistPolicy(nextKind, [])
  }

  const handleSubjectsChange = (nextSubjects: SelectableAccessSubject[]) => {
    if (nextSubjects.length === 0)
      return
    setDraft({
      fingerprint: policyFingerprint,
      kind: 'specific',
      subjects: nextSubjects,
    })
    persistPolicy('specific', nextSubjects)
  }

  return (
    <div className="grid gap-x-3 gap-y-2 sm:grid-cols-[minmax(96px,112px)_minmax(0,1fr)]">
      <span className="pt-1.5 system-xs-regular text-text-tertiary">
        {environmentName(environment)}
      </span>
      <div className="min-w-0">
        <PermissionPicker
          value={permissionKind}
          disabled={controlsDisabled}
          onChange={handlePermissionChange}
        />
      </div>
      {permissionKind === 'specific' && (
        <div className="flex min-w-0 flex-col gap-2 sm:col-start-2">
          <div className="flex flex-wrap items-center gap-2">
            <SubjectPicker
              selectedSubjects={subjects}
              disabled={controlsDisabled}
              onChange={handleSubjectsChange}
            />
            {subjects.length === 0 && (
              <span className="system-xs-regular text-text-tertiary">
                {t('access.members.emptySelection')}
              </span>
            )}
          </div>
          {subjects.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {subjects.map(subject => (
                <SubjectPill
                  key={subjectKey(subject)}
                  subject={subject}
                  disabled={controlsDisabled || subjects.length <= 1}
                  onRemove={() => handleSubjectsChange(subjects.filter(item => subjectKey(item) !== subjectKey(subject)))}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
