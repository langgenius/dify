'use client'
import { RiAddCircleFill, RiArrowRightSLine, RiOrganizationChart } from '@remixicon/react'
import { useTranslation } from 'react-i18next'
import { useState } from 'react'
import Avatar from '../../base/avatar'
import Button from '../../base/button'
import Checkbox from '../../base/checkbox'
import Input from '../../base/input'
import { PortalToFollowElem, PortalToFollowElemContent, PortalToFollowElemTrigger } from '../../base/portal-to-follow-elem'
import classNames from '@/utils/classnames'

export default function AddMemberOrGroupDialog() {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)

  return <PortalToFollowElem open={open} onOpenChange={setOpen} offset={{ crossAxis: 300 }} placement='bottom-end'>
    <PortalToFollowElemTrigger asChild>
      <Button variant='ghost-accent' size='small' className='shrink-0 flex items-center gap-x-0.5' onClick={() => setOpen(!open)}>
        <RiAddCircleFill className='w-4 h-4' />
        <span>{t('common.operation.add')}</span>
      </Button>
    </PortalToFollowElemTrigger>
    <PortalToFollowElemContent className='z-[25]'>
      <div className='w-[400px] max-h-[400px] overflow-y-auto flex flex-col border-[0.5px] border-components-panel-border rounded-xl bg-components-panel-bg-blur backdrop-blur-[5px] shadow-lg'>
        <div className='p-2 pb-0.5'>
          <Input placeholder={t('app.accessControlDialog.operateGroupAndMember.searchPlaceholder') as string} />
        </div>
        <div className='flex items-center h-7 px-2 py-0.5'>
          <span className='system-xs-regular text-text-tertiary'>{t('app.accessControlDialog.operateGroupAndMember.allMembers')}</span>
        </div>
        <RenderGroupOrMember data={[]} />
      </div>
    </PortalToFollowElemContent>
  </PortalToFollowElem>
}

type RenderGroupOrMemberProps = {
  data: any[]
}

function RenderGroupOrMember({ data }: RenderGroupOrMemberProps) {
  return <div className='p-1'>
    {data.map((item, index) => {
      if (item.type === 'group')
        return <GroupItem key={index} />
      return <MemberItem key={index} />
    })}
  </div>
}

function GroupItem() {
  const { t } = useTranslation()
  return <BaseItem>
    <Checkbox className='w-4 h-4 shrink-0' />
    <div className='flex item-center grow'>
      <div className='w-5 h-5 rounded-full bg-components-icon-bg-blue-solid overflow-hidden mr-2'>
        <div className='w-full h-full flex items-center justify-center bg-access-app-icon-mask-bg'>
          <RiOrganizationChart className='w-[14px] h-[14px] text-components-avatar-shape-fill-stop-0' />
        </div>
      </div>
      <p className='system-sm-medium text-text-secondary mr-1'>Name</p>
      <p className='system-xs-regular text-text-tertiary'>5</p>
    </div>
    <Button size="small" variant='ghost-accent' className='py-1 px-1.5 shrink-0 flex items-center justify-between'>
      <span className='px-[3px]'>{t('app.accessControlDialog.operateGroupAndMember.expand')}</span>
      <RiArrowRightSLine className='w-4 h-4' />
    </Button>
  </BaseItem>
}

function MemberItem() {
  return <BaseItem className='pr-3'>
    <Checkbox className='w-4 h-4 shrink-0' />
    <div className='flex items-center grow'>
      <div className='w-5 h-5 rounded-full bg-components-icon-bg-blue-solid overflow-hidden mr-2'>
        <div className='w-full h-full flex items-center justify-center bg-access-app-icon-mask-bg'>
          <Avatar className='w-[14px] h-[14px]' textClassName='text-[12px]' avatar={null} name='M' />
        </div>
      </div>
      <p className='system-sm-medium text-text-secondary mr-1'>Name</p>
      <p className='system-xs-regular text-text-tertiary'>5</p>
    </div>
    <p className='system-xs-regular text-text-quaternary'>douxc512@gmail.com</p>
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
