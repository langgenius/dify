'use client'

import type { ComboboxChangeEventDetails } from '@langgenius/dify-ui/combobox'
import type { AccessControlSubjects } from '../specific-groups-or-members'
import type {
  AccessControlAccount,
  AccessControlGroup,
  Subject,
  SubjectAccount,
  SubjectGroup,
} from '@/models/access-control'
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxInputGroup,
  ComboboxList,
  ComboboxStatus,
  ComboboxTrigger,
} from '@langgenius/dify-ui/combobox'
import { useDebounce } from 'ahooks'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Loading from '@/app/components/base/loading'
import { SubjectType } from '@/models/access-control'
import { useSearchForWhiteListCandidates } from '@/service/access-control'
import { SelectedGroupsBreadcrumb } from './breadcrumb'
import { SubjectItem } from './subject-item'

type AddMemberOrGroupDialogProps = {
  subjects: AccessControlSubjects
  onChange: (subjects: AccessControlSubjects) => void
}

export default function AddMemberOrGroupDialog({
  subjects: selectedAccessSubjects,
  onChange,
}: AddMemberOrGroupDialogProps) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [keyword, setKeyword] = useState('')
  const [selectedGroupsForBreadcrumb, setSelectedGroupsForBreadcrumb] = useState<
    AccessControlGroup[]
  >([])
  const scrollRootRef = useRef<HTMLDivElement>(null)
  const anchorRef = useRef<HTMLDivElement>(null)
  const { groups: specificGroups, members: specificMembers } = selectedAccessSubjects
  const debouncedKeyword = useDebounce(keyword, { wait: 500 })

  const lastAvailableGroup = selectedGroupsForBreadcrumb[selectedGroupsForBreadcrumb.length - 1]
  const { isLoading, isFetchingNextPage, fetchNextPage, data } = useSearchForWhiteListCandidates(
    { keyword: debouncedKeyword, groupId: lastAvailableGroup?.id, resultsPerPage: 10 },
    open,
  )
  const pages = data?.pages ?? []
  const subjects = pages.flatMap((page) => page.subjects ?? [])
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
      observer = new IntersectionObserver(
        (entries) => {
          if (entries[0]!.isIntersecting && !isLoading && hasMore) fetchNextPage()
        },
        { root: scrollRootRef.current, rootMargin: '20px' },
      )
      observer.observe(anchorRef.current)
    }
    return () => observer?.disconnect()
  }, [isLoading, fetchNextPage, hasMore])

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) setKeyword('')

    setOpen(nextOpen)
  }

  const handleInputValueChange = (inputValue: string, details: ComboboxChangeEventDetails) => {
    if (details.reason !== 'item-press') setKeyword(inputValue)
  }

  const handleValueChange = (nextSubjects: Subject[]) => {
    const nextGroups: AccessControlGroup[] = []
    const nextMembers: AccessControlAccount[] = []

    for (const subject of nextSubjects) {
      if (subject.subjectType === SubjectType.GROUP)
        nextGroups.push((subject as SubjectGroup).groupData)
      else nextMembers.push((subject as SubjectAccount).accountData)
    }

    onChange({ groups: nextGroups, members: nextMembers })
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
        aria-label={t(($) => $['operation.add'], { ns: 'common' })}
        icon={false}
        size="small"
        className="h-6 w-auto min-w-13 shrink-0 rounded-md border-0 bg-transparent px-2 py-0 text-xs font-medium text-components-button-secondary-accent-text hover:bg-state-accent-hover focus-visible:bg-state-accent-hover data-popup-open:bg-state-accent-hover"
      >
        <span className="inline-flex min-w-0 items-center justify-center gap-x-0.5 whitespace-nowrap">
          <span className="i-ri-add-circle-fill size-4 shrink-0" aria-hidden="true" />
          <span className="shrink-0">{t(($) => $['operation.add'], { ns: 'common' })}</span>
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
              <span
                className="mr-0.5 i-ri-search-line size-4 shrink-0 text-text-tertiary"
                aria-hidden="true"
              />
              <ComboboxInput
                aria-label={t(
                  ($) => $['accessControlDialog.operateGroupAndMember.searchPlaceholder'],
                  { ns: 'app' },
                )}
                placeholder={t(
                  ($) => $['accessControlDialog.operateGroupAndMember.searchPlaceholder'],
                  { ns: 'app' },
                )}
                className="block h-4.5 grow px-1 py-0 text-[13px] text-text-primary"
              />
            </ComboboxInputGroup>
          </div>
          {isLoading ? (
            <ComboboxStatus className="p-1">
              <Loading />
            </ComboboxStatus>
          ) : (
            <>
              {shouldShowBreadcrumb && (
                <div className="flex h-7 items-center px-2 py-0.5">
                  <SelectedGroupsBreadcrumb
                    groups={selectedGroupsForBreadcrumb}
                    onChange={setSelectedGroupsForBreadcrumb}
                  />
                </div>
              )}
              {hasResults ? (
                <>
                  <ComboboxList<Subject> className="max-h-none p-1">
                    {(subject) => (
                      <SubjectItem
                        key={getSubjectValue(subject)}
                        subject={subject}
                        selectedGroups={specificGroups}
                        onExpandGroup={(group) =>
                          setSelectedGroupsForBreadcrumb((groups) => [...groups, group])
                        }
                      />
                    )}
                  </ComboboxList>
                  {isFetchingNextPage && <Loading />}
                  <div ref={anchorRef} className="h-0" />
                </>
              ) : (
                <ComboboxEmpty className="flex h-7 items-center justify-center px-2 py-0.5">
                  {t(($) => $['accessControlDialog.operateGroupAndMember.noResult'], { ns: 'app' })}
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
  if (subject.subjectType === SubjectType.GROUP) return (subject as SubjectGroup).groupData.name

  return (subject as SubjectAccount).accountData.name
}

function getSubjectValue(subject: Subject) {
  return `${subject.subjectType}:${subject.subjectId}`
}

function isSameSubject(item: Subject, value: Subject) {
  return item.subjectId === value.subjectId && item.subjectType === value.subjectType
}
