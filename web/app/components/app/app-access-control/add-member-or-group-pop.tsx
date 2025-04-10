'use client'
import { RiAddCircleFill, RiArrowRightSLine, RiOrganizationChart } from '@remixicon/react'
import { useTranslation } from 'react-i18next'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useDebounce } from 'ahooks'
import Avatar from '../../base/avatar'
import Button from '../../base/button'
import Checkbox from '../../base/checkbox'
import Input from '../../base/input'
import { PortalToFollowElem, PortalToFollowElemContent, PortalToFollowElemTrigger } from '../../base/portal-to-follow-elem'
import Loading from '../../base/loading'
import useAccessControlStore from './access-control-store'
import classNames from '@/utils/classnames'
import { useSearchForWhiteListCandidates } from '@/service/access-control'
import type { AccessControlAccount, AccessControlGroup, Subject, SubjectAccount, SubjectGroup } from '@/models/access-control'
import { SubjectType } from '@/models/access-control'
import { useSelector } from '@/context/app-context'

export default function AddMemberOrGroupDialog() {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [keyword, setKeyword] = useState('')
  const debouncedKeyword = useDebounce(keyword, { wait: 500 })

  const { isPending, isFetchingNextPage, fetchNextPage, data } = useSearchForWhiteListCandidates({ keyword: debouncedKeyword, resultsPerPage: 10 }, open)
  const handleKeywordChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setKeyword(e.target.value)
  }

  const anchorRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const hasMore = data?.pages?.[0].hasMore ?? false
    let observer: IntersectionObserver | undefined
    if (anchorRef.current) {
      observer = new IntersectionObserver((entries) => {
        if (entries[0].isIntersecting && !isPending && hasMore)
          fetchNextPage()
      }, { rootMargin: '20px' })
      observer.observe(anchorRef.current)
    }
    return () => observer?.disconnect()
  }, [isPending, fetchNextPage, anchorRef, data])

  return <PortalToFollowElem open={open} onOpenChange={setOpen} offset={{ crossAxis: 300 }} placement='bottom-end'>
    <PortalToFollowElemTrigger asChild>
      <Button variant='ghost-accent' size='small' className='shrink-0 flex items-center gap-x-0.5' onClick={() => setOpen(!open)}>
        <RiAddCircleFill className='w-4 h-4' />
        <span>{t('common.operation.add')}</span>
      </Button>
    </PortalToFollowElemTrigger>
    <PortalToFollowElemContent className='z-[25]'>
      <div className='w-[400px] max-h-[400px] relative overflow-y-auto flex flex-col border-[0.5px] border-components-panel-border rounded-xl bg-components-panel-bg-blur backdrop-blur-[5px] shadow-lg'>
        <div className='p-2 pb-0.5 sticky top-0'>
          <Input value={keyword} onChange={handleKeywordChange} showLeftIcon placeholder={t('app.accessControlDialog.operateGroupAndMember.searchPlaceholder') as string} />
        </div>
        {
          isPending
            ? <div className='p-1'><Loading /></div>
            : (data?.pages?.length ?? 0) > 0
              ? <>
                <div className='flex items-center h-7 px-2 py-0.5'>
                  <span className='system-xs-regular text-text-tertiary'>{t('app.accessControlDialog.operateGroupAndMember.allMembers')}</span>
                </div>
                {renderGroupOrMember(data?.pages ?? [])}
                {isFetchingNextPage && <div className='p-1'><Loading /></div>}
                <div ref={anchorRef} className='h-0'> </div>
              </>
              : <div className='flex items-center justify-center h-7 px-2 py-0.5'>
                <span className='system-xs-regular text-text-tertiary'>{t('app.accessControlDialog.operateGroupAndMember.noResult')}</span>
              </div>
        }
      </div>
    </PortalToFollowElemContent>
  </PortalToFollowElem>
}

type GroupOrMemberData = { subjects: Subject[]; currPage: number }[]
function renderGroupOrMember(data: GroupOrMemberData) {
  return data?.map((page) => {
    return <div key={`search_group_member_page_${page.currPage}`} className='p-1'>
      {page.subjects?.map((item, index) => {
        if (item.subjectType === SubjectType.GROUP)
          return <GroupItem key={index} group={(item as SubjectGroup).groupData} />
        return <MemberItem key={index} member={(item as SubjectAccount).accountData} />
      })}
    </div>
  }) ?? null
}

type GroupItemProps = {
  group: AccessControlGroup
}
function GroupItem({ group }: GroupItemProps) {
  const { t } = useTranslation()
  const specificGroups = useAccessControlStore(s => s.specificGroups)
  const setSpecificGroups = useAccessControlStore(s => s.setSpecificGroups)
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
  return <BaseItem>
    <Checkbox checked={isChecked} className='w-4 h-4 shrink-0' onCheck={handleCheckChange} />
    <div className='flex item-center grow'>
      <div className='w-5 h-5 rounded-full bg-components-icon-bg-blue-solid overflow-hidden mr-2'>
        <div className='w-full h-full flex items-center justify-center bg-access-app-icon-mask-bg'>
          <RiOrganizationChart className='w-[14px] h-[14px] text-components-avatar-shape-fill-stop-0' />
        </div>
      </div>
      <p className='system-sm-medium text-text-secondary mr-1'>{group.name}</p>
      <p className='system-xs-regular text-text-tertiary'>{group.groupSize}</p>
    </div>
    <Button size="small" variant='ghost-accent' className='py-1 px-1.5 shrink-0 flex items-center justify-between'>
      <span className='px-[3px]'>{t('app.accessControlDialog.operateGroupAndMember.expand')}</span>
      <RiArrowRightSLine className='w-4 h-4' />
    </Button>
  </BaseItem>
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
  return <BaseItem className='pr-3'>
    <Checkbox checked={isChecked} className='w-4 h-4 shrink-0' onCheck={handleCheckChange} />
    <div className='flex items-center grow'>
      <div className='w-5 h-5 rounded-full bg-components-icon-bg-blue-solid overflow-hidden mr-2'>
        <div className='w-full h-full flex items-center justify-center bg-access-app-icon-mask-bg'>
          <Avatar className='w-[14px] h-[14px]' textClassName='text-[12px]' avatar={null} name={member.name} />
        </div>
      </div>
      <p className='system-sm-medium text-text-secondary mr-1'>{member.name}</p>
      {currentUser.email === member.email && <p className='system-xs-regular text-text-tertiary'>({t('common.you')})</p>}
    </div>
    <p className='system-xs-regular text-text-quaternary'>{member.email}</p>
  </BaseItem>
}

type BaseItemProps = {
  className?: string
  children: React.ReactNode
}
function BaseItem({ children, className }: BaseItemProps) {
  return <div className={classNames('p-1 pl-2 flex items-center space-x-2 hover:rounded-lg hover:bg-state-base-hover cursor-pointer', className)}>
    {children}
  </div>
}
