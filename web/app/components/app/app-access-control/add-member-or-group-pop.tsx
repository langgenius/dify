'use client'
import { RiAddCircleFill, RiArrowRightSLine, RiOrganizationChart } from '@remixicon/react'
import { useTranslation } from 'react-i18next'
import { useEffect, useRef, useState } from 'react'
import { useDebounce } from 'ahooks'
import Avatar from '../../base/avatar'
import Button from '../../base/button'
import Checkbox from '../../base/checkbox'
import Input from '../../base/input'
import { PortalToFollowElem, PortalToFollowElemContent, PortalToFollowElemTrigger } from '../../base/portal-to-follow-elem'
import Loading from '../../base/loading'
import classNames from '@/utils/classnames'
import { useSearchForWhiteListCandidates } from '@/service/access-control'
import type { AccessControlAccount, AccessControlGroup, Subject, SubjectAccount, SubjectGroup } from '@/models/access-control'
import { SubjectType } from '@/models/access-control'

export default function AddMemberOrGroupDialog() {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [keyword, setKeyword] = useState('')
  const [pageNumber, setPageNumber] = useState(1)
  const debouncedKeyword = useDebounce(keyword, { wait: 500 })

  const { isPending, data } = useSearchForWhiteListCandidates({ keyword: debouncedKeyword, pageNumber, resultsPerPage: 10 }, open)
  const handleKeywordChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setKeyword(e.target.value)
  }

  const anchorRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const hasMore = data?.has_more ?? true
    let observer: IntersectionObserver | undefined
    if (anchorRef.current) {
      observer = new IntersectionObserver((entries) => {
        if (entries[0].isIntersecting && !isPending && hasMore)
          setPageNumber((size: number) => size + 1)
      }, { rootMargin: '20px' })
      observer.observe(anchorRef.current)
    }
    return () => observer?.disconnect()
  }, [isPending, setPageNumber, anchorRef, data])

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
          (data?.subjects?.length ?? 0) > 0
            ? <>
              <div className='flex items-center h-7 px-2 py-0.5'>
                <span className='system-xs-regular text-text-tertiary'>{t('app.accessControlDialog.operateGroupAndMember.allMembers')}</span>
              </div>
              <RenderGroupOrMember data={data?.subjects ?? []} />
              <div ref={anchorRef} className='h-0'> </div>
            </>
            : isPending
              ? null
              : <div className='flex items-center justify-center h-7 px-2 py-0.5'>
                <span className='system-xs-regular text-text-tertiary'>{t('app.accessControlDialog.operateGroupAndMember.noResult')}</span>
              </div>
        }
        {
          isPending && <div className='p-1'><Loading /></div>
        }
      </div>
    </PortalToFollowElemContent>
  </PortalToFollowElem>
}

type RenderGroupOrMemberProps = {
  data: Subject[]
}

function RenderGroupOrMember({ data }: RenderGroupOrMemberProps) {
  return <div className='p-1'>
    {data.map((item, index) => {
      if (item.subjectType === SubjectType.Group)
        return <GroupItem key={index} group={(item as SubjectGroup).groupData} />
      return <MemberItem key={index} member={(item as SubjectAccount).accountData} />
    })}
  </div>
}

type GroupItemProps = {
  group: AccessControlGroup
}
function GroupItem({ group }: GroupItemProps) {
  const { t } = useTranslation()
  return <BaseItem>
    <Checkbox className='w-4 h-4 shrink-0' />
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
  return <BaseItem className='pr-3'>
    <Checkbox className='w-4 h-4 shrink-0' />
    <div className='flex items-center grow'>
      <div className='w-5 h-5 rounded-full bg-components-icon-bg-blue-solid overflow-hidden mr-2'>
        <div className='w-full h-full flex items-center justify-center bg-access-app-icon-mask-bg'>
          <Avatar className='w-[14px] h-[14px]' textClassName='text-[12px]' avatar={null} name={member.name} />
        </div>
      </div>
      <p className='system-sm-medium text-text-secondary mr-1'>{member.name}</p>
      <p className='system-xs-regular text-text-tertiary'>You</p>
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
