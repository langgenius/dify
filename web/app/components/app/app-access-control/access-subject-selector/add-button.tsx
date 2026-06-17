'use client'

import type { ComboboxRootChangeEventDetails } from '@langgenius/dify-ui/combobox'
import type { AccessSubjectSelectionProps } from './types'
import type {
  AccessControlGroup,
  Subject,
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
import { SkeletonRectangle } from '@/app/components/base/skeleton'
import { useSearchForWhiteListCandidates } from '@/service/access-control'
import { SelectedGroupsBreadCrumb, SubjectItem } from './subject-options'
import {
  getSubjectLabel,
  getSubjectValue,
  isSameSubject,
  selectionValueToSubjects,
  subjectsToSelectionValue,
} from './utils'

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
  const selectedSubjects = selectionValueToSubjects({
    groups: selectedGroups,
    members: selectedMembers,
  })
  const hasResults = pages.length > 0 && subjects.length > 0
  const shouldShowBreadcrumb = hasResults || selectedGroupsForBreadcrumb.length > 0
  const hasMore = pages[pages.length - 1]?.hasMore ?? false

  useEffect(() => {
    let observer: IntersectionObserver | undefined
    if (anchorRef.current) {
      observer = new IntersectionObserver((entries) => {
        if (entries[0]!.isIntersecting && !isLoading && !isFetchingNextPage && hasMore)
          fetchNextPage()
      }, { root: scrollRootRef.current, rootMargin: '20px' })
      observer.observe(anchorRef.current)
    }
    return () => observer?.disconnect()
  }, [fetchNextPage, hasMore, isFetchingNextPage, isLoading])

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
    onChange(subjectsToSelectionValue(nextSubjects))
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
                  <SubjectOptionsSkeleton />
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

function SubjectOptionsSkeleton() {
  return (
    <div className="flex flex-col gap-1">
      {[0, 1, 2, 3, 4].map(index => (
        <div key={index} className="flex min-h-8 items-center gap-2 rounded-lg p-1 pl-2">
          <SkeletonRectangle className="my-0 size-4 shrink-0 animate-pulse rounded-sm" />
          <SkeletonRectangle className="my-0 size-5 shrink-0 animate-pulse rounded-full" />
          <SkeletonRectangle className="my-0 h-3.5 w-32 animate-pulse" />
          <SkeletonRectangle className="my-0 h-3 w-16 animate-pulse" />
        </div>
      ))}
    </div>
  )
}
