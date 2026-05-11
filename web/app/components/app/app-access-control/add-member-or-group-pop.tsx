'use client'
import type { AccessControlAccount, AccessControlGroup, Subject, SubjectAccount, SubjectGroup } from '@/models/access-control'
import { FloatingOverlay } from '@floating-ui/react'
import { Avatar } from '@langgenius/dify-ui/avatar'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { Popover, PopoverContent, PopoverTrigger } from '@langgenius/dify-ui/popover'
import { RiAddCircleFill, RiArrowRightSLine, RiOrganizationChart } from '@remixicon/react'
import { useDebounce } from 'ahooks'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useSelector } from '@/context/app-context'
import { SubjectType } from '@/models/access-control'
import { useSearchForWhiteListCandidates } from '@/service/access-control'
import useAccessControlStore from '../../../../context/access-control-store'
import Checkbox from '../../base/checkbox'
import Input from '../../base/input'
import Loading from '../../base/loading'

export default function AddMemberOrGroupDialog() {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [keyword, setKeyword] = useState('')
  const selectedGroupsForBreadcrumb = useAccessControlStore(s => s.selectedGroupsForBreadcrumb)
  const debouncedKeyword = useDebounce(keyword, { wait: 500 })

  const lastAvailableGroup = selectedGroupsForBreadcrumb[selectedGroupsForBreadcrumb.length - 1]
  const { isLoading, isFetchingNextPage, fetchNextPage, data } = useSearchForWhiteListCandidates({ keyword: debouncedKeyword, groupId: lastAvailableGroup?.id, resultsPerPage: 10 }, open)
  const handleKeywordChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setKeyword(e.target.value)
  }

  const anchorRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const hasMore = data?.pages?.[0]?.hasMore ?? false
    let observer: IntersectionObserver | undefined
    if (anchorRef.current) {
      observer = new IntersectionObserver((entries) => {
        if (entries[0]!.isIntersecting && !isLoading && hasMore)
          fetchNextPage()
      }, { rootMargin: '20px' })
      observer.observe(anchorRef.current)
    }
    return () => observer?.disconnect()
  }, [isLoading, fetchNextPage, anchorRef, data])

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={(
          <Button variant="ghost-accent" size="small" className="flex shrink-0 items-center gap-x-0.5">
            <RiAddCircleFill className="h-4 w-4" />
            <span>{t('operation.add', { ns: 'common' })}</span>
          </Button>
        )}
      />
      {open && <FloatingOverlay />}
      <PopoverContent
        placement="bottom-end"
        alignOffset={300}
        popupClassName="border-none bg-transparent shadow-none"
      >
        <div className="relative flex max-h-[400px] w-[400px] flex-col overflow-y-auto rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg-blur shadow-lg backdrop-blur-[5px]">
          <div className="sticky top-0 z-10 bg-components-panel-bg-blur p-2 pb-0.5 backdrop-blur-[5px]">
            <Input value={keyword} onChange={handleKeywordChange} showLeftIcon placeholder={t('accessControlDialog.operateGroupAndMember.searchPlaceholder', { ns: 'app' }) as string} />
          </div>
          {
            isLoading
              ? <div className="p-1"><Loading /></div>
              : (data?.pages?.length ?? 0) > 0
                  ? (
                      <>
                        <div className="flex h-7 items-center px-2 py-0.5">
                          <SelectedGroupsBreadCrumb />
                        </div>
                        <div className="p-1">
                          {renderGroupOrMember(data?.pages ?? [])}
                          {isFetchingNextPage && <Loading />}
                        </div>
                        <div ref={anchorRef} className="h-0"> </div>
                      </>
                    )
                  : (
                      <div className="flex h-7 items-center justify-center px-2 py-0.5">
                        <span className="system-xs-regular text-text-tertiary">{t('accessControlDialog.operateGroupAndMember.noResult', { ns: 'app' })}</span>
                      </div>
                    )
          }
        </div>
      </PopoverContent>
    </Popover>
  )
}

type GroupOrMemberData = { subjects: Subject[], currPage: number }[]
function renderGroupOrMember(data: GroupOrMemberData) {
  return data?.map((page) => {
    return (
      <div key={`search_group_member_page_${page.currPage}`}>
        {page.subjects?.map((item, index) => {
          if (item.subjectType === SubjectType.GROUP)
            return <GroupItem key={index} group={(item as SubjectGroup).groupData} />
          return <MemberItem key={index} member={(item as SubjectAccount).accountData} />
        })}
      </div>
    )
  }) ?? null
}

function SelectedGroupsBreadCrumb() {
  const selectedGroupsForBreadcrumb = useAccessControlStore(s => s.selectedGroupsForBreadcrumb)
  const setSelectedGroupsForBreadcrumb = useAccessControlStore(s => s.setSelectedGroupsForBreadcrumb)
  const { t } = useTranslation()

  const handleBreadCrumbClick = useCallback((index: number) => {
    const newGroups = selectedGroupsForBreadcrumb.slice(0, index + 1)
    setSelectedGroupsForBreadcrumb(newGroups)
  }, [setSelectedGroupsForBreadcrumb, selectedGroupsForBreadcrumb])
  const handleReset = useCallback(() => {
    setSelectedGroupsForBreadcrumb([])
  }, [setSelectedGroupsForBreadcrumb])
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
}
function GroupItem({ group }: GroupItemProps) {
  const { t } = useTranslation()
  const specificGroups = useAccessControlStore(s => s.specificGroups)
  const setSpecificGroups = useAccessControlStore(s => s.setSpecificGroups)
  const selectedGroupsForBreadcrumb = useAccessControlStore(s => s.selectedGroupsForBreadcrumb)
  const setSelectedGroupsForBreadcrumb = useAccessControlStore(s => s.setSelectedGroupsForBreadcrumb)
  const isChecked = specificGroups.some(g => g.id === group.id)
  const handleCheckChange = useCallback(() => {
    if (!isChecked) {
      const newGroups = [...specificGroups, group]
      setSpecificGroups(newGroups)
    }
    else {
      const newGroups = specificGroups.filter(g => g.id !== group.id)
      setSpecificGroups(newGroups)
    }
  }, [specificGroups, setSpecificGroups, group, isChecked])

  const handleExpandClick = useCallback(() => {
    setSelectedGroupsForBreadcrumb([...selectedGroupsForBreadcrumb, group])
  }, [selectedGroupsForBreadcrumb, setSelectedGroupsForBreadcrumb, group])
  return (
    <BaseItem>
      <Checkbox checked={isChecked} className="h-4 w-4 shrink-0" onCheck={handleCheckChange} />
      <div className="item-center flex grow">
        <div className="mr-2 h-5 w-5 overflow-hidden rounded-full bg-components-icon-bg-blue-solid">
          <div className="bg-access-app-icon-mask-bg flex h-full w-full items-center justify-center">
            <RiOrganizationChart className="h-[14px] w-[14px] text-components-avatar-shape-fill-stop-0" />
          </div>
        </div>
        <p className="mr-1 system-sm-medium text-text-secondary">{group.name}</p>
        <p className="system-xs-regular text-text-tertiary">{group.groupSize}</p>
      </div>
      <Button
        size="small"
        disabled={isChecked}
        variant="ghost-accent"
        className="flex shrink-0 items-center justify-between px-1.5 py-1"
        onClick={handleExpandClick}
      >
        <span className="px-[3px]">{t('accessControlDialog.operateGroupAndMember.expand', { ns: 'app' })}</span>
        <RiArrowRightSLine className="h-4 w-4" />
      </Button>
    </BaseItem>
  )
}

type MemberItemProps = {
  member: AccessControlAccount
}
function MemberItem({ member }: MemberItemProps) {
  const currentUser = useSelector(s => s.userProfile)
  const { t } = useTranslation()
  const specificMembers = useAccessControlStore(s => s.specificMembers)
  const setSpecificMembers = useAccessControlStore(s => s.setSpecificMembers)
  const isChecked = specificMembers.some(m => m.id === member.id)
  const handleCheckChange = useCallback(() => {
    if (!isChecked) {
      const newMembers = [...specificMembers, member]
      setSpecificMembers(newMembers)
    }
    else {
      const newMembers = specificMembers.filter(m => m.id !== member.id)
      setSpecificMembers(newMembers)
    }
  }, [specificMembers, setSpecificMembers, member, isChecked])
  return (
    <BaseItem className="pr-3">
      <Checkbox checked={isChecked} className="h-4 w-4 shrink-0" onCheck={handleCheckChange} />
      <div className="flex grow items-center">
        <div className="mr-2 h-5 w-5 overflow-hidden rounded-full bg-components-icon-bg-blue-solid">
          <div className="bg-access-app-icon-mask-bg flex h-full w-full items-center justify-center">
            <Avatar size="xxs" avatar={null} name={member.name} />
          </div>
        </div>
        <p className="mr-1 system-sm-medium text-text-secondary">{member.name}</p>
        {currentUser.email === member.email && (
          <p className="system-xs-regular text-text-tertiary">
            (
            {t('you', { ns: 'common' })}
            )
          </p>
        )}
      </div>
      <p className="system-xs-regular text-text-quaternary">{member.email}</p>
    </BaseItem>
  )
}

type BaseItemProps = {
  className?: string
  children: React.ReactNode
}
function BaseItem({ children, className }: BaseItemProps) {
  return (
    <div className={cn('flex cursor-pointer items-center space-x-2 p-1 pl-2 hover:rounded-lg hover:bg-state-base-hover', className)}>
      {children}
    </div>
  )
}
