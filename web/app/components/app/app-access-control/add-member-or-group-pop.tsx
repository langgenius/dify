'use client'
import type { ComboboxRootChangeEventDetails } from '@langgenius/dify-ui/combobox'
import type { AccessControlAccount, AccessControlGroup, Subject, SubjectAccount, SubjectGroup } from '@/models/access-control'
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
import { RiAddCircleFill, RiArrowRightSLine, RiOrganizationChart } from '@remixicon/react'
import { useDebounce } from 'ahooks'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useSelector } from '@/context/app-context'
import { SubjectType } from '@/models/access-control'
import { useSearchForWhiteListCandidates } from '@/service/access-control'
import useAccessControlStore from '../../../../context/access-control-store'
import Loading from '../../base/loading'

export default function AddMemberOrGroupDialog() {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [keyword, setKeyword] = useState('')
  const scrollRootRef = useRef<HTMLDivElement>(null)
  const anchorRef = useRef<HTMLDivElement>(null)
  const specificGroups = useAccessControlStore(s => s.specificGroups)
  const setSpecificGroups = useAccessControlStore(s => s.setSpecificGroups)
  const specificMembers = useAccessControlStore(s => s.specificMembers)
  const setSpecificMembers = useAccessControlStore(s => s.setSpecificMembers)
  const selectedGroupsForBreadcrumb = useAccessControlStore(s => s.selectedGroupsForBreadcrumb)
  const debouncedKeyword = useDebounce(keyword, { wait: 500 })

  const lastAvailableGroup = selectedGroupsForBreadcrumb[selectedGroupsForBreadcrumb.length - 1]
  const { isLoading, isFetchingNextPage, fetchNextPage, data } = useSearchForWhiteListCandidates({ keyword: debouncedKeyword, groupId: lastAvailableGroup?.id, resultsPerPage: 10 }, open)
  const pages = data?.pages ?? []
  const subjects = pages.flatMap(page => page.subjects ?? [])
  const selectedSubjects = [
    ...specificGroups.map(groupToSubject),
    ...specificMembers.map(memberToSubject),
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
    if (!nextOpen)
      setKeyword('')

    setOpen(nextOpen)
  }

  const handleInputValueChange = (inputValue: string, details: ComboboxRootChangeEventDetails) => {
    if (details.reason !== 'item-press')
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

    setSpecificGroups(nextGroups)
    setSpecificMembers(nextMembers)
  }

  return (
    <Combobox<Subject, true>
      multiple
      open={open}
      value={selectedSubjects}
      inputValue={keyword}
      items={subjects}
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
        className="flex h-6 w-auto shrink-0 items-center gap-x-0.5 rounded-md border-0 bg-transparent px-2 py-0 text-xs font-medium text-components-button-secondary-accent-text hover:bg-state-accent-hover focus-visible:bg-state-accent-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid data-open:bg-state-accent-hover"
      >
        <RiAddCircleFill className="h-4 w-4" aria-hidden="true" />
        <span>{t('operation.add', { ns: 'common' })}</span>
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
                      <SelectedGroupsBreadCrumb />
                    </div>
                  )}
                  {hasResults
                    ? (
                        <>
                          <ComboboxList className="max-h-none p-1">
                            {(subject: Subject) => <SubjectItem key={getSubjectValue(subject)} subject={subject} />}
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

function SubjectItem({ subject }: { subject: Subject }) {
  if (subject.subjectType === SubjectType.GROUP)
    return <GroupItem group={(subject as SubjectGroup).groupData} subject={subject} />

  return <MemberItem member={(subject as SubjectAccount).accountData} subject={subject} />
}

function SelectedGroupsBreadCrumb() {
  const selectedGroupsForBreadcrumb = useAccessControlStore(s => s.selectedGroupsForBreadcrumb)
  const setSelectedGroupsForBreadcrumb = useAccessControlStore(s => s.setSelectedGroupsForBreadcrumb)
  const { t } = useTranslation()

  const handleBreadCrumbClick = (index: number) => {
    const newGroups = selectedGroupsForBreadcrumb.slice(0, index + 1)
    setSelectedGroupsForBreadcrumb(newGroups)
  }
  const handleReset = () => {
    setSelectedGroupsForBreadcrumb([])
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
          <div key={index} className="flex items-center gap-x-0.5 system-xs-regular text-text-tertiary">
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
}
function GroupItem({ group, subject }: GroupItemProps) {
  const { t } = useTranslation()
  const specificGroups = useAccessControlStore(s => s.specificGroups)
  const selectedGroupsForBreadcrumb = useAccessControlStore(s => s.selectedGroupsForBreadcrumb)
  const setSelectedGroupsForBreadcrumb = useAccessControlStore(s => s.setSelectedGroupsForBreadcrumb)
  const isChecked = specificGroups.some(g => g.id === group.id)

  const handleExpandClick = () => {
    setSelectedGroupsForBreadcrumb([...selectedGroupsForBreadcrumb, group])
  }

  return (
    <div className="flex items-center gap-2 rounded-lg hover:bg-state-base-hover">
      <BaseItem subject={subject}>
        <SelectionBox checked={isChecked} />
        <ComboboxItemText className="flex grow items-center px-0">
          <div className="mr-2 h-5 w-5 overflow-hidden rounded-full bg-components-icon-bg-blue-solid">
            <div className="bg-access-app-icon-mask-bg flex h-full w-full items-center justify-center">
              <RiOrganizationChart className="h-[14px] w-[14px] text-components-avatar-shape-fill-stop-0" aria-hidden="true" />
            </div>
          </div>
          <span className="mr-1 system-sm-medium text-text-secondary">{group.name}</span>
          <span className="system-xs-regular text-text-tertiary">{group.groupSize}</span>
        </ComboboxItemText>
      </BaseItem>
      <Button
        size="small"
        disabled={isChecked}
        variant="ghost-accent"
        className="mr-1 flex shrink-0 items-center justify-between px-1.5 py-1"
        onPointerDown={event => event.preventDefault()}
        onClick={handleExpandClick}
      >
        <span className="px-[3px]">{t('accessControlDialog.operateGroupAndMember.expand', { ns: 'app' })}</span>
        <RiArrowRightSLine className="h-4 w-4" aria-hidden="true" />
      </Button>
    </div>
  )
}

type MemberItemProps = {
  member: AccessControlAccount
  subject: Subject
}
function MemberItem({ member, subject }: MemberItemProps) {
  const currentUser = useSelector(s => s.userProfile)
  const { t } = useTranslation()
  const specificMembers = useAccessControlStore(s => s.specificMembers)
  const isChecked = specificMembers.some(m => m.id === member.id)
  return (
    <BaseItem subject={subject} className="pr-3">
      <SelectionBox checked={isChecked} />
      <ComboboxItemText className="flex grow items-center px-0">
        <div className="mr-2 h-5 w-5 overflow-hidden rounded-full bg-components-icon-bg-blue-solid">
          <div className="bg-access-app-icon-mask-bg flex h-full w-full items-center justify-center">
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
    </BaseItem>
  )
}

type BaseItemProps = {
  className?: string
  subject: Subject
  children: React.ReactNode
}
function BaseItem({ children, className, subject }: BaseItemProps) {
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
