'use client'

import type { AccessControlSubjects } from '../specific-groups-or-members'
import type {
  AccessControlGroup,
  Subject,
  SubjectAccount,
  SubjectGroup,
} from '@/models/access-control'
import { Button } from '@langgenius/dify-ui/button'
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from '@langgenius/dify-ui/popover'
import {
  ScrollArea,
  ScrollAreaContent,
  ScrollAreaScrollbar,
  ScrollAreaThumb,
  ScrollAreaViewport,
} from '@langgenius/dify-ui/scroll-area'
import { useDebounce } from 'ahooks'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Loading from '@/app/components/base/loading'
import { SearchInput } from '@/app/components/base/search-input'
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
  const debouncedKeyword = useDebounce(keyword, { wait: 500 })
  const lastAvailableGroup = selectedGroupsForBreadcrumb[selectedGroupsForBreadcrumb.length - 1]
  const { isLoading, isFetchingNextPage, fetchNextPage, data } = useSearchForWhiteListCandidates(
    { keyword: debouncedKeyword, groupId: lastAvailableGroup?.id, resultsPerPage: 10 },
    open,
  )
  const pages = data?.pages ?? []
  const candidates = pages.flatMap((page) => page.subjects ?? [])
  const hasResults = pages.length > 0 && candidates.length > 0
  const shouldShowBreadcrumb = hasResults || selectedGroupsForBreadcrumb.length > 0
  const hasMore = pages[pages.length - 1]?.hasMore ?? false
  const searchLabel = t(($) => $['accessControlDialog.operateGroupAndMember.searchPlaceholder'], {
    ns: 'app',
  })
  const noResultLabel = t(($) => $['accessControlDialog.operateGroupAndMember.noResult'], {
    ns: 'app',
  })

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
    if (!nextOpen) {
      setKeyword('')
      setSelectedGroupsForBreadcrumb([])
    }
    setOpen(nextOpen)
  }

  const handleSubjectToggle = (subject: Subject) => {
    const { groups, members } = selectedAccessSubjects

    if (subject.subjectType === SubjectType.GROUP) {
      const group = (subject as SubjectGroup).groupData
      const selected = groups.some((candidate) => candidate.id === group.id)
      onChange({
        groups: selected
          ? groups.filter((candidate) => candidate.id !== group.id)
          : [...groups, group],
        members,
      })
      return
    }

    const member = (subject as SubjectAccount).accountData
    const selected = members.some((candidate) => candidate.id === member.id)
    onChange({
      groups,
      members: selected
        ? members.filter((candidate) => candidate.id !== member.id)
        : [...members, member],
    })
  }

  const isSubjectSelected = (subject: Subject) =>
    subject.subjectType === SubjectType.GROUP
      ? selectedAccessSubjects.groups.some((group) => group.id === subject.subjectId)
      : selectedAccessSubjects.members.some((member) => member.id === subject.subjectId)

  const statusText = isLoading
    ? t(($) => $.loading, { ns: 'common' })
    : hasResults
      ? null
      : noResultLabel

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger
        render={
          <Button
            variant="ghost-accent"
            size="small"
            aria-label={t(($) => $['operation.add'], { ns: 'common' })}
            className="min-w-13 shrink-0 gap-x-0.5 px-2 data-popup-open:bg-state-accent-hover"
          >
            <span className="i-ri-add-circle-fill size-4 shrink-0" aria-hidden="true" />
            <span className="shrink-0">{t(($) => $['operation.add'], { ns: 'common' })}</span>
          </Button>
        }
      />
      <PopoverContent
        placement="bottom-end"
        alignOffset={300}
        className="relative flex max-h-[400px] w-[400px] flex-col overflow-hidden bg-components-panel-bg-blur p-0 backdrop-blur-[5px]"
      >
        <PopoverTitle className="sr-only">{searchLabel}</PopoverTitle>
        <ScrollArea className="relative min-h-0 flex-1 overflow-hidden">
          <ScrollAreaViewport
            ref={scrollRootRef}
            role="region"
            aria-label={searchLabel}
            style={{ overflowX: 'hidden' }}
          >
            <ScrollAreaContent style={{ minWidth: 0 }}>
              <div className="sticky top-0 z-10 bg-components-panel-bg-blur p-2 pb-0.5 backdrop-blur-[5px]">
                <SearchInput
                  aria-label={searchLabel}
                  placeholder={searchLabel}
                  value={keyword}
                  onValueChange={setKeyword}
                />
              </div>
              {shouldShowBreadcrumb && (
                <div className="flex h-7 items-center px-2 py-0.5">
                  <SelectedGroupsBreadcrumb
                    groups={selectedGroupsForBreadcrumb}
                    onChange={setSelectedGroupsForBreadcrumb}
                  />
                </div>
              )}
              {hasResults && (
                <ul className="p-1">
                  {candidates.map((subject) => (
                    <SubjectItem
                      key={`${subject.subjectType}:${subject.subjectId}`}
                      subject={subject}
                      selected={isSubjectSelected(subject)}
                      onToggle={() => handleSubjectToggle(subject)}
                      onExpandGroup={(group) =>
                        setSelectedGroupsForBreadcrumb((groups) => [...groups, group])
                      }
                    />
                  ))}
                </ul>
              )}
              <div
                role="status"
                aria-live="polite"
                aria-atomic="true"
                className={
                  statusText ? 'flex min-h-7 items-center justify-center px-2 py-0.5' : 'h-0'
                }
              >
                {isLoading ? (
                  <>
                    <span className="sr-only">{statusText}</span>
                    <div className="w-full" aria-hidden="true">
                      <Loading />
                    </div>
                  </>
                ) : (
                  statusText
                )}
              </div>
              {isFetchingNextPage && <Loading />}
              <div ref={anchorRef} className="h-0" />
            </ScrollAreaContent>
          </ScrollAreaViewport>
          <ScrollAreaScrollbar>
            <ScrollAreaThumb />
          </ScrollAreaScrollbar>
        </ScrollArea>
      </PopoverContent>
    </Popover>
  )
}
