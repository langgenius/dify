'use client'

import type { ComboboxRootChangeEventDetails } from '@langgenius/dify-ui/combobox'
import type { ReactNode } from 'react'
import type {
  AccessControlAccount,
  AccessControlGroup,
  Subject,
  SubjectAccount,
  SubjectGroup,
} from '@/models/access-control'
import { Avatar } from '@langgenius/dify-ui/avatar'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxInputGroup,
  ComboboxItem,
  ComboboxItemText,
  ComboboxList,
  ComboboxStatus,
  ComboboxTrigger,
} from '@langgenius/dify-ui/combobox'
import { useDebounce } from 'ahooks'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useSelector } from '@/context/app-context'
import { SubjectType } from '@/models/access-control'
import { useSearchForWhiteListCandidates } from '@/service/access-control'
import Loading from '../loading'

export type AccessSubjectSelectionValue = {
  groups: AccessControlGroup[]
  members: AccessControlAccount[]
}

type AccessSubjectSelectionProps = {
  selectedGroups: AccessControlGroup[]
  selectedMembers: AccessControlAccount[]
  onChange: (value: AccessSubjectSelectionValue) => void
}

type AccessSubjectAddButtonProps = AccessSubjectSelectionProps & {
  disabled?: boolean
  breadcrumbGroups?: AccessControlGroup[]
  onBreadcrumbGroupsChange?: (groups: AccessControlGroup[]) => void
}

export function AccessSubjectAddButton({
  selectedGroups,
  selectedMembers,
  onChange,
  disabled,
  breadcrumbGroups,
  onBreadcrumbGroupsChange,
}: AccessSubjectAddButtonProps) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [keyword, setKeyword] = useState('')
  const [internalBreadcrumbGroups, setInternalBreadcrumbGroups] = useState<AccessControlGroup[]>([])
  const scrollRootRef = useRef<HTMLDivElement>(null)
  const anchorRef = useRef<HTMLDivElement>(null)
  const selectedGroupsForBreadcrumb = breadcrumbGroups ?? internalBreadcrumbGroups
  const setSelectedGroupsForBreadcrumb = onBreadcrumbGroupsChange ?? setInternalBreadcrumbGroups
  const debouncedKeyword = useDebounce(keyword, { wait: 500 })

  const lastAvailableGroup = selectedGroupsForBreadcrumb[selectedGroupsForBreadcrumb.length - 1]
  const { isLoading, isFetchingNextPage, fetchNextPage, data } = useSearchForWhiteListCandidates({
    keyword: debouncedKeyword,
    groupId: lastAvailableGroup?.id,
    resultsPerPage: 10,
  }, open && !disabled)
  const pages = data?.pages ?? []
  const subjects = pages.flatMap(page => page.subjects ?? [])
  const selectedSubjects = [
    ...selectedGroups.map(groupToSubject),
    ...selectedMembers.map(memberToSubject),
  ]
  const hasResults = pages.length > 0 && subjects.length > 0
  const shouldShowBreadcrumb = hasResults || selectedGroupsForBreadcrumb.length > 0
  const hasMore = pages[pages.length - 1]?.hasMore ?? false

  useEffect(() => {
    let observer: IntersectionObserver | undefined
    if (anchorRef.current) {
      observer = new IntersectionObserver((entries) => {
        if (entries[0]!.isIntersecting && !isLoading && hasMore)
          fetchNextPage()
      }, { root: scrollRootRef.current, rootMargin: '20px' })
      observer.observe(anchorRef.current)
    }
    return () => observer?.disconnect()
  }, [isLoading, fetchNextPage, hasMore])

  const handleOpenChange = (nextOpen: boolean) => {
    if (nextOpen && disabled)
      return
    if (!nextOpen)
      setKeyword('')

    setOpen(nextOpen)
  }

  const handleInputValueChange = (inputValue: string, details: ComboboxRootChangeEventDetails) => {
    if (!disabled && details.reason !== 'item-press')
      setKeyword(inputValue)
  }

  const handleValueChange = (nextSubjects: Subject[]) => {
    const nextGroups: AccessControlGroup[] = []
    const nextMembers: AccessControlAccount[] = []

    for (const subject of nextSubjects) {
      if (subject.subjectType === SubjectType.GROUP)
        nextGroups.push((subject as SubjectGroup).groupData)
      else
        nextMembers.push((subject as SubjectAccount).accountData)
    }

    onChange({
      groups: nextGroups,
      members: nextMembers,
    })
  }

  return (
    <Combobox<Subject, true>
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
      <ComboboxTrigger
        aria-label={t('operation.add', { ns: 'common' })}
        icon={false}
        size="small"
        disabled={disabled}
        className="h-6 w-auto min-w-[52px] shrink-0 rounded-md border-0 bg-transparent px-2 py-0 text-xs font-medium text-components-button-secondary-accent-text hover:bg-state-accent-hover focus-visible:bg-state-accent-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid data-popup-open:bg-state-accent-hover"
      >
        <span className="inline-flex min-w-0 items-center justify-center gap-x-0.5 whitespace-nowrap">
          <span className="i-ri-add-circle-fill size-4 shrink-0" aria-hidden="true" />
          <span className="shrink-0">{t('operation.add', { ns: 'common' })}</span>
        </span>
      </ComboboxTrigger>
      <ComboboxContent
        placement="bottom-end"
        alignOffset={300}
        popupClassName="relative flex max-h-[400px] w-[400px] flex-col overflow-hidden rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg-blur p-0 shadow-lg backdrop-blur-[5px]"
      >
        <div ref={scrollRootRef} className="min-h-0 overflow-y-auto">
          <div className="sticky top-0 z-10 bg-components-panel-bg-blur p-2 pb-0.5 backdrop-blur-[5px]">
            <ComboboxInputGroup className="h-8 min-h-8 px-2">
              <span className="mr-0.5 i-ri-search-line size-4 shrink-0 text-text-tertiary" aria-hidden="true" />
              <ComboboxInput
                aria-label={t('accessControlDialog.operateGroupAndMember.searchPlaceholder', { ns: 'app' })}
                placeholder={t('accessControlDialog.operateGroupAndMember.searchPlaceholder', { ns: 'app' })}
                className="block h-4.5 grow px-1 py-0 text-[13px] text-text-primary"
              />
            </ComboboxInputGroup>
          </div>
          {isLoading
            ? (
                <ComboboxStatus className="p-1">
                  <Loading />
                </ComboboxStatus>
              )
            : (
                <>
                  {shouldShowBreadcrumb && (
                    <div className="flex h-7 items-center px-2 py-0.5">
                      <SelectedGroupsBreadCrumb
                        selectedGroupsForBreadcrumb={selectedGroupsForBreadcrumb}
                        onChange={setSelectedGroupsForBreadcrumb}
                      />
                    </div>
                  )}
                  {hasResults
                    ? (
                        <>
                          <ComboboxList className="max-h-none p-1">
                            {(subject: Subject) => (
                              <SubjectItem
                                key={getSubjectValue(subject)}
                                subject={subject}
                                selectedGroups={selectedGroups}
                                selectedMembers={selectedMembers}
                                onExpandGroup={group => setSelectedGroupsForBreadcrumb([...selectedGroupsForBreadcrumb, group])}
                              />
                            )}
                          </ComboboxList>
                          {isFetchingNextPage && <Loading />}
                          <div ref={anchorRef} className="h-0" />
                        </>
                      )
                    : (
                        <ComboboxEmpty className="flex h-7 items-center justify-center px-2 py-0.5">
                          {t('accessControlDialog.operateGroupAndMember.noResult', { ns: 'app' })}
                        </ComboboxEmpty>
                      )}
                </>
              )}
        </div>
      </ComboboxContent>
    </Combobox>
  )
}

type AccessSubjectSelectionListProps = AccessSubjectSelectionProps & {
  loading?: boolean
  className?: string
}

export function AccessSubjectSelectionList({
  selectedGroups,
  selectedMembers,
  onChange,
  loading,
  className,
}: AccessSubjectSelectionListProps) {
  return (
    <div className={cn('flex max-h-[400px] flex-col gap-y-2 overflow-y-auto rounded-lg bg-background-section p-2', className)}>
      {loading
        ? <Loading />
        : (
            <RenderGroupsAndMembers
              selectedGroups={selectedGroups}
              selectedMembers={selectedMembers}
              onChange={onChange}
            />
          )}
    </div>
  )
}

function RenderGroupsAndMembers({
  selectedGroups,
  selectedMembers,
  onChange,
}: AccessSubjectSelectionProps) {
  const { t } = useTranslation()
  if (selectedGroups.length <= 0 && selectedMembers.length <= 0) {
    return (
      <div className="px-2 pt-5 pb-1.5">
        <p className="text-center system-xs-regular text-text-tertiary">
          {t('accessControlDialog.noGroupsOrMembers', { ns: 'app' })}
        </p>
      </div>
    )
  }

  return (
    <>
      <p className="sticky top-0 system-2xs-medium-uppercase text-text-tertiary">
        {t('accessControlDialog.groups', { ns: 'app', count: selectedGroups.length ?? 0 })}
      </p>
      <div className="flex flex-row flex-wrap gap-1">
        {selectedGroups.map(group => (
          <SelectedGroupItem
            key={group.id}
            group={group}
            selectedGroups={selectedGroups}
            selectedMembers={selectedMembers}
            onChange={onChange}
          />
        ))}
      </div>
      <p className="sticky top-0 system-2xs-medium-uppercase text-text-tertiary">
        {t('accessControlDialog.members', { ns: 'app', count: selectedMembers.length ?? 0 })}
      </p>
      <div className="flex flex-row flex-wrap gap-1">
        {selectedMembers.map(member => (
          <SelectedMemberItem
            key={member.id}
            member={member}
            selectedGroups={selectedGroups}
            selectedMembers={selectedMembers}
            onChange={onChange}
          />
        ))}
      </div>
    </>
  )
}

function groupToSubject(group: AccessControlGroup): SubjectGroup {
  return {
    subjectId: group.id,
    subjectType: SubjectType.GROUP,
    groupData: group,
  }
}

function memberToSubject(member: AccessControlAccount): SubjectAccount {
  return {
    subjectId: member.id,
    subjectType: SubjectType.ACCOUNT,
    accountData: member,
  }
}

function getSubjectLabel(subject: Subject) {
  if (subject.subjectType === SubjectType.GROUP)
    return (subject as SubjectGroup).groupData.name

  return (subject as SubjectAccount).accountData.name
}

function getSubjectValue(subject: Subject) {
  return `${subject.subjectType}:${subject.subjectId}`
}

function isSameSubject(item: Subject, value: Subject) {
  return item.subjectId === value.subjectId && item.subjectType === value.subjectType
}

function SubjectItem({
  subject,
  selectedGroups,
  selectedMembers,
  onExpandGroup,
}: {
  subject: Subject
  selectedGroups: AccessControlGroup[]
  selectedMembers: AccessControlAccount[]
  onExpandGroup: (group: AccessControlGroup) => void
}) {
  if (subject.subjectType === SubjectType.GROUP) {
    return (
      <GroupItem
        group={(subject as SubjectGroup).groupData}
        subject={subject}
        selectedGroups={selectedGroups}
        onExpandGroup={onExpandGroup}
      />
    )
  }

  return (
    <MemberItem
      member={(subject as SubjectAccount).accountData}
      subject={subject}
      selectedMembers={selectedMembers}
    />
  )
}

function SelectedGroupsBreadCrumb({
  selectedGroupsForBreadcrumb,
  onChange,
}: {
  selectedGroupsForBreadcrumb: AccessControlGroup[]
  onChange: (groups: AccessControlGroup[]) => void
}) {
  const { t } = useTranslation()

  const handleBreadCrumbClick = (index: number) => {
    const newGroups = selectedGroupsForBreadcrumb.slice(0, index + 1)
    onChange(newGroups)
  }
  const handleReset = () => {
    onChange([])
  }
  const hasBreadcrumb = selectedGroupsForBreadcrumb.length > 0

  return (
    <div className="flex h-7 items-center gap-x-0.5 px-2 py-0.5">
      {hasBreadcrumb
        ? (
            <button
              type="button"
              className="cursor-pointer border-none bg-transparent p-0 text-left system-xs-regular text-text-accent focus-visible:ring-1 focus-visible:ring-components-input-border-active focus-visible:outline-hidden"
              onClick={handleReset}
            >
              {t('accessControlDialog.operateGroupAndMember.allMembers', { ns: 'app' })}
            </button>
          )
        : (
            <span className="system-xs-regular text-text-tertiary">{t('accessControlDialog.operateGroupAndMember.allMembers', { ns: 'app' })}</span>
          )}
      {selectedGroupsForBreadcrumb.map((group, index) => {
        const isLastGroup = index === selectedGroupsForBreadcrumb.length - 1

        return (
          <div key={group.id} className="flex items-center gap-x-0.5 system-xs-regular text-text-tertiary">
            <span>/</span>
            {isLastGroup
              ? <span>{group.name}</span>
              : (
                  <button
                    type="button"
                    className="cursor-pointer border-none bg-transparent p-0 text-left system-xs-regular text-text-accent focus-visible:ring-1 focus-visible:ring-components-input-border-active focus-visible:outline-hidden"
                    onClick={() => handleBreadCrumbClick(index)}
                  >
                    {group.name}
                  </button>
                )}
          </div>
        )
      })}
    </div>
  )
}

type GroupItemProps = {
  group: AccessControlGroup
  subject: Subject
  selectedGroups: AccessControlGroup[]
  onExpandGroup: (group: AccessControlGroup) => void
}

function GroupItem({ group, subject, selectedGroups, onExpandGroup }: GroupItemProps) {
  const { t } = useTranslation()
  const isChecked = selectedGroups.some(selectedGroup => selectedGroup.id === group.id)

  return (
    <div className="flex items-center gap-2 rounded-lg hover:bg-state-base-hover">
      <ComboboxBaseItem subject={subject}>
        <SelectionBox checked={isChecked} />
        <ComboboxItemText className="flex grow items-center px-0">
          <div className="mr-2 size-5 overflow-hidden rounded-full bg-components-icon-bg-blue-solid">
            <div className="flex size-full items-center justify-center bg-[image:var(--color-access-app-icon-mask-bg)]">
              <span className="i-ri-organization-chart h-[14px] w-[14px] text-components-avatar-shape-fill-stop-0" aria-hidden="true" />
            </div>
          </div>
          <span className="mr-1 system-sm-medium text-text-secondary">{group.name}</span>
          <span className="system-xs-regular text-text-tertiary">{group.groupSize}</span>
        </ComboboxItemText>
      </ComboboxBaseItem>
      <Button
        size="small"
        disabled={isChecked}
        variant="ghost-accent"
        className="mr-1 flex shrink-0 items-center justify-between px-1.5 py-1"
        onPointerDown={event => event.preventDefault()}
        onClick={() => onExpandGroup(group)}
      >
        <span className="px-[3px]">{t('accessControlDialog.operateGroupAndMember.expand', { ns: 'app' })}</span>
        <span className="i-ri-arrow-right-s-line size-4" aria-hidden="true" />
      </Button>
    </div>
  )
}

type MemberItemProps = {
  member: AccessControlAccount
  subject: Subject
  selectedMembers: AccessControlAccount[]
}

function MemberItem({ member, subject, selectedMembers }: MemberItemProps) {
  const currentUser = useSelector(s => s.userProfile)
  const { t } = useTranslation()
  const isChecked = selectedMembers.some(selectedMember => selectedMember.id === member.id)
  return (
    <ComboboxBaseItem subject={subject} className="pr-3">
      <SelectionBox checked={isChecked} />
      <ComboboxItemText className="flex grow items-center px-0">
        <div className="mr-2 size-5 overflow-hidden rounded-full bg-components-icon-bg-blue-solid">
          <div className="flex size-full items-center justify-center bg-[image:var(--color-access-app-icon-mask-bg)]">
            <Avatar size="xxs" avatar={null} name={member.name} />
          </div>
        </div>
        <span className="mr-1 system-sm-medium text-text-secondary">{member.name}</span>
        {currentUser.email === member.email && (
          <span className="system-xs-regular text-text-tertiary">
            (
            {t('you', { ns: 'common' })}
            )
          </span>
        )}
      </ComboboxItemText>
      <span className="system-xs-regular text-text-quaternary">{member.email}</span>
    </ComboboxBaseItem>
  )
}

type ComboboxBaseItemProps = {
  className?: string
  subject: Subject
  children: ReactNode
}

function ComboboxBaseItem({ children, className, subject }: ComboboxBaseItemProps) {
  return (
    <ComboboxItem
      value={subject}
      className={cn(
        'mx-0 flex min-h-8 grow grid-cols-none items-center gap-2 rounded-lg p-1 pl-2',
        className,
      )}
    >
      {children}
    </ComboboxItem>
  )
}

function SelectionBox({ checked }: { checked: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'flex size-4 shrink-0 items-center justify-center rounded-sm shadow-xs shadow-shadow-shadow-3',
        checked
          ? 'bg-components-checkbox-bg text-components-checkbox-icon'
          : 'border border-components-checkbox-border bg-components-checkbox-bg-unchecked',
      )}
    >
      {checked && <span className="i-ri-check-line size-3" />}
    </span>
  )
}

type SelectedGroupItemProps = AccessSubjectSelectionProps & {
  group: AccessControlGroup
}

function SelectedGroupItem({
  group,
  selectedGroups,
  selectedMembers,
  onChange,
}: SelectedGroupItemProps) {
  const handleRemoveGroup = () => {
    onChange({
      groups: selectedGroups.filter(selectedGroup => selectedGroup.id !== group.id),
      members: selectedMembers,
    })
  }

  return (
    <SelectedBaseItem
      icon={<span className="i-ri-organization-chart h-[14px] w-[14px] text-components-avatar-shape-fill-stop-0" aria-hidden="true" />}
      onRemove={handleRemoveGroup}
    >
      <p className="system-xs-regular text-text-primary">{group.name}</p>
      <p className="system-xs-regular text-text-tertiary">{group.groupSize}</p>
    </SelectedBaseItem>
  )
}

type SelectedMemberItemProps = AccessSubjectSelectionProps & {
  member: AccessControlAccount
}

function SelectedMemberItem({
  member,
  selectedGroups,
  selectedMembers,
  onChange,
}: SelectedMemberItemProps) {
  const handleRemoveMember = () => {
    onChange({
      groups: selectedGroups,
      members: selectedMembers.filter(selectedMember => selectedMember.id !== member.id),
    })
  }

  return (
    <SelectedBaseItem
      icon={<Avatar size="xxs" avatar={null} name={member.name} />}
      onRemove={handleRemoveMember}
    >
      <p className="system-xs-regular text-text-primary">{member.name}</p>
    </SelectedBaseItem>
  )
}

type SelectedBaseItemProps = {
  icon: ReactNode
  children: ReactNode
  onRemove?: () => void
}

function SelectedBaseItem({ icon, onRemove, children }: SelectedBaseItemProps) {
  const { t } = useTranslation()

  return (
    <div className="group flex flex-row items-center gap-x-1 rounded-full border-[0.5px] border-components-panel-border-subtle bg-components-badge-white-to-dark p-1 pr-1.5 shadow-xs">
      <div className="size-5 overflow-hidden rounded-full bg-components-icon-bg-blue-solid">
        <div className="flex size-full items-center justify-center bg-[image:var(--color-access-app-icon-mask-bg)]">
          {icon}
        </div>
      </div>
      {children}
      <button
        type="button"
        className="flex size-4 cursor-pointer items-center justify-center border-none bg-transparent p-0 focus-visible:ring-1 focus-visible:ring-components-input-border-active focus-visible:outline-hidden"
        aria-label={t('operation.remove', { ns: 'common' })}
        onClick={onRemove}
      >
        <span className="i-ri-close-circle-fill h-[14px] w-[14px] text-text-quaternary" aria-hidden="true" />
      </button>
    </div>
  )
}
