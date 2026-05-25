'use client'

import type {
  AccessPolicy,
  AccessSubject,
  Environment,
  Subject,
} from '@dify/contracts/enterprise/types.gen'
import type { ComboboxRootChangeEventDetails } from '@langgenius/dify-ui/combobox'
import { cn } from '@langgenius/dify-ui/cn'
import {
  Combobox,
  ComboboxChip,
  ComboboxChipRemove,
  ComboboxChips,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxInputGroup,
  ComboboxInputTrigger,
  ComboboxItem,
  ComboboxItemIndicator,
  ComboboxItemText,
  ComboboxList,
  ComboboxStatus,
  ComboboxValue,
} from '@langgenius/dify-ui/combobox'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@langgenius/dify-ui/dropdown-menu'
import { toast } from '@langgenius/dify-ui/toast'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useDebounce } from 'ahooks'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { SkeletonRectangle, SkeletonRow } from '@/app/components/base/skeleton'
import { consoleQuery } from '@/service/client'
import { environmentName } from '../../../environment'
import {
  DetailTableCell,
  DetailTableRow,
} from '../../table'

type AccessPermissionKind = 'organization' | 'specific' | 'anyone'
type AccessMode = NonNullable<AccessPolicy['mode']>
type AccessSubjectType = NonNullable<AccessSubject['subjectType']>

const ACCESS_MODE_PUBLIC = 'ACCESS_MODE_PUBLIC' satisfies AccessMode
const ACCESS_MODE_PRIVATE = 'ACCESS_MODE_PRIVATE' satisfies AccessMode
const ACCESS_MODE_PRIVATE_ALL = 'ACCESS_MODE_PRIVATE_ALL' satisfies AccessMode
const ACCESS_SUBJECT_TYPE_ACCOUNT = 'ACCESS_SUBJECT_TYPE_ACCOUNT' satisfies AccessSubjectType
const ACCESS_SUBJECT_TYPE_GROUP = 'ACCESS_SUBJECT_TYPE_GROUP' satisfies AccessSubjectType

function accessModeToPermissionKey(mode?: AccessPolicy['mode']): AccessPermissionKind {
  if (mode === ACCESS_MODE_PRIVATE)
    return 'specific'
  if (mode === ACCESS_MODE_PUBLIC)
    return 'anyone'
  return 'organization'
}

function permissionKeyToAccessMode(key: AccessPermissionKind): AccessMode {
  if (key === 'organization')
    return ACCESS_MODE_PRIVATE_ALL
  if (key === 'specific')
    return ACCESS_MODE_PRIVATE
  return ACCESS_MODE_PUBLIC
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
          'inline-flex h-8 w-full min-w-0 items-center gap-2 rounded-lg border border-components-input-border-active bg-components-input-bg-normal px-2.5 system-sm-regular text-text-secondary hover:bg-state-base-hover',
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
  subjectType: AccessSubjectType
  name?: string
  memberCount?: number
}

function subjectTypeFromSubject(subject: Subject): AccessSubjectType {
  if (subject.subjectType === 'group' || subject.groupData)
    return ACCESS_SUBJECT_TYPE_GROUP
  return ACCESS_SUBJECT_TYPE_ACCOUNT
}

function normalizeSubject(subject: Subject): SelectableAccessSubject | undefined {
  const id = subject.subjectId || subject.accountData?.id || subject.groupData?.id
  if (!id)
    return undefined

  return {
    id,
    subjectType: subjectTypeFromSubject(subject),
    name: subject.accountData?.name || subject.accountData?.email || subject.groupData?.name || id,
    memberCount: subject.groupData?.groupSize,
  }
}

function subjectKey(subject: Pick<SelectableAccessSubject, 'id' | 'subjectType'>) {
  return `${subject.subjectType}:${subject.id}`
}

function getSubjectLabel(subject: SelectableAccessSubject) {
  return subject.name || subject.id
}

function getSubjectValue(subject: SelectableAccessSubject) {
  return subjectKey(subject)
}

function isSameSubject(item: SelectableAccessSubject, value: SelectableAccessSubject) {
  return item.id === value.id && item.subjectType === value.subjectType
}

const SUBJECT_PICKER_SKELETON_KEYS = ['first-subject', 'second-subject', 'third-subject']

function policySubjects(subjects: SelectableAccessSubject[]): AccessSubject[] {
  return subjects.map(subject => ({
    subjectId: subject.id,
    subjectType: subject.subjectType,
  }))
}

function selectedSubjectsFromPolicy(policy?: AccessPolicy) {
  return policy?.subjects
    ?.map((subject): SelectableAccessSubject | undefined => {
      if (!subject.subjectId || !subject.subjectType)
        return undefined
      return {
        id: subject.subjectId,
        subjectType: subject.subjectType,
        name: subject.subjectId,
      }
    })
    .filter((subject): subject is SelectableAccessSubject => Boolean(subject)) ?? []
}

function SubjectIcon({ subject }: {
  subject: SelectableAccessSubject
}) {
  const isGroup = subject.subjectType === ACCESS_SUBJECT_TYPE_GROUP

  return (
    <span className={cn(isGroup ? 'i-ri-group-line' : 'i-ri-user-line', 'size-3.5 shrink-0 text-text-tertiary')} aria-hidden="true" />
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

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen)
      setKeyword('')
    setOpen(nextOpen)
  }

  const handleInputValueChange = (inputValue: string, details: ComboboxRootChangeEventDetails) => {
    if (details.reason !== 'item-press')
      setKeyword(inputValue)
  }

  const handleValueChange = (nextSubjects: SelectableAccessSubject[]) => {
    setKeyword('')
    onChange(nextSubjects)
  }

  return (
    <Combobox<SelectableAccessSubject, true>
      multiple
      open={open}
      value={selectedSubjects}
      inputValue={keyword}
      items={subjects}
      disabled={disabled}
      itemToStringLabel={getSubjectLabel}
      itemToStringValue={getSubjectValue}
      isItemEqualToValue={isSameSubject}
      filter={null}
      onOpenChange={handleOpenChange}
      onInputValueChange={handleInputValueChange}
      onValueChange={handleValueChange}
    >
      <ComboboxInputGroup className="h-auto min-h-8 w-full max-w-full overflow-hidden py-1 pr-1">
        <ComboboxValue>
          {(selectedValue: SelectableAccessSubject[]) => (
            <>
              {selectedValue.length > 0 && (
                <ComboboxChips className="flex-nowrap overflow-hidden">
                  {selectedValue.map(subject => (
                    <ComboboxChip
                      key={subjectKey(subject)}
                      className="shrink-0 rounded-full border border-divider-subtle bg-components-badge-white-to-dark"
                    >
                      <SubjectIcon subject={subject} />
                      <span className="max-w-32 truncate">{getSubjectLabel(subject)}</span>
                      {subject.subjectType === ACCESS_SUBJECT_TYPE_GROUP && subject.memberCount != null && (
                        <span className="system-2xs-regular text-text-tertiary">{subject.memberCount}</span>
                      )}
                      <ComboboxChipRemove
                        disabled={disabled || selectedSubjects.length <= 1}
                        aria-label={t('operation.remove', { ns: 'common' })}
                      >
                        <span className="i-ri-close-circle-fill size-3.5" aria-hidden="true" />
                      </ComboboxChipRemove>
                    </ComboboxChip>
                  ))}
                </ComboboxChips>
              )}
              <ComboboxInput
                aria-label={t('access.members.pickPlaceholder')}
                placeholder={selectedValue.length ? '' : t('access.members.pickPlaceholder')}
                className={cn('px-2 py-0 system-sm-medium', selectedValue.length ? 'min-w-16' : 'min-w-0')}
              />
            </>
          )}
        </ComboboxValue>
        <ComboboxInputTrigger />
      </ComboboxInputGroup>
      <ComboboxContent popupClassName="w-(--anchor-width) min-w-90 p-0">
        {subjectsQuery.isLoading
          ? (
              <ComboboxStatus className="flex flex-col gap-2 px-3 py-3">
                {SUBJECT_PICKER_SKELETON_KEYS.map(key => (
                  <SkeletonRow key={key} className="h-6">
                    <SkeletonRectangle className="h-3 w-full animate-pulse" />
                  </SkeletonRow>
                ))}
              </ComboboxStatus>
            )
          : (
              <>
                <ComboboxList className="p-1">
                  {subjects.map(subject => (
                    <ComboboxItem
                      key={subjectKey(subject)}
                      value={subject}
                      className="mx-0"
                    >
                      <ComboboxItemText className="flex items-center gap-2 px-0">
                        <SubjectIcon subject={subject} />
                        <span className="min-w-0 flex-1 truncate">{getSubjectLabel(subject)}</span>
                        {subject.subjectType === ACCESS_SUBJECT_TYPE_GROUP && subject.memberCount != null && (
                          <span className="shrink-0 system-xs-regular text-text-tertiary">
                            {t('access.members.memberCount', { count: subject.memberCount })}
                          </span>
                        )}
                      </ComboboxItemText>
                      <ComboboxItemIndicator />
                    </ComboboxItem>
                  ))}
                </ComboboxList>
                <ComboboxEmpty className="px-3 py-5 text-center system-xs-regular">
                  {t('access.members.empty')}
                </ComboboxEmpty>
              </>
            )}
      </ComboboxContent>
    </Combobox>
  )
}

type EnvironmentPermissionRowProps = {
  appInstanceId: string
  environment: Environment
  summaryPolicy?: AccessPolicy
}

export function EnvironmentPermissionRow({
  appInstanceId,
  environment,
  summaryPolicy,
}: EnvironmentPermissionRowProps) {
  const { t } = useTranslation('deployments')
  const environmentId = environment.id
  const accessPolicyQuery = useQuery(consoleQuery.enterprise.accessService.getAccessPolicy.queryOptions({
    input: {
      params: {
        appInstanceId,
        environmentId: environmentId ?? '',
      },
    },
    enabled: Boolean(environmentId),
  }))
  const setEnvironmentAccessPolicy = useMutation(consoleQuery.enterprise.accessService.putAccessPolicy.mutationOptions())
  const policy = accessPolicyQuery.data?.policy ?? summaryPolicy
  const policyKind = accessModeToPermissionKey(policy?.mode)
  const policySubjectFingerprint = policy?.subjects
    ?.map(subject => `${subject.subjectType ?? ''}:${subject.subjectId ?? ''}`)
    .join(',')
  const policyFingerprint = [
    policy?.mode ?? '',
    policySubjectFingerprint ?? '',
  ].join(':')
  const policySelectedSubjects = policyKind === 'specific' ? selectedSubjectsFromPolicy(policy) : []
  const [draft, setDraft] = useState<{
    fingerprint?: string
    kind?: AccessPermissionKind
    subjects?: SelectableAccessSubject[]
  }>({})
  const hasDraft = draft.fingerprint === policyFingerprint
  const permissionKind = hasDraft && draft.kind ? draft.kind : policyKind
  const subjects = hasDraft && draft.subjects ? draft.subjects : policySelectedSubjects
  const isSaving = setEnvironmentAccessPolicy.isPending
  const controlsDisabled = isSaving || accessPolicyQuery.isLoading || accessPolicyQuery.isError

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
          mode: permissionKeyToAccessMode(nextKind),
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
    <DetailTableRow className="block pc:table-row">
      <DetailTableCell className="block h-auto px-4 pt-3 pb-1 align-top pc:table-cell pc:px-2.5 pc:py-[5px] pc:pl-3">
        <div className="system-2xs-medium-uppercase text-text-tertiary pc:hidden">
          {t('access.permissions.col.environment')}
        </div>
        <div className="mt-1 flex min-h-8 min-w-0 items-center pc:mt-0">
          <span className="min-w-0 truncate text-text-primary">
            {environmentName(environment)}
          </span>
        </div>
      </DetailTableCell>
      <DetailTableCell className="block h-auto px-4 py-1 align-top pc:table-cell pc:px-2.5 pc:py-[5px] pc:pl-3">
        <div className="mb-1 system-2xs-medium-uppercase text-text-tertiary pc:hidden">
          {t('access.permissions.col.permission')}
        </div>
        <PermissionPicker
          value={permissionKind}
          disabled={controlsDisabled}
          onChange={handlePermissionChange}
        />
      </DetailTableCell>
      <DetailTableCell className="block h-auto px-4 pt-1 pb-3 align-top pc:table-cell pc:px-2.5 pc:py-[5px] pc:pl-3">
        <div className="mb-1 system-2xs-medium-uppercase text-text-tertiary pc:hidden">
          {t('access.permissions.col.subjects')}
        </div>
        {permissionKind === 'specific'
          ? (
              <>
                <SubjectPicker
                  selectedSubjects={subjects}
                  disabled={controlsDisabled}
                  onChange={handleSubjectsChange}
                />
                {subjects.length === 0 && (
                  <span className="mt-1.5 block system-xs-regular text-text-tertiary">
                    {t('access.members.emptySelection')}
                  </span>
                )}
              </>
            )
          : (
              <div className="flex min-h-8 items-center system-xs-regular text-text-tertiary">
                {t(`access.permission.${permissionKind}Desc`)}
              </div>
            )}
      </DetailTableCell>
    </DetailTableRow>
  )
}
