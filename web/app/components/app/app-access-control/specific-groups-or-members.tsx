'use client'
import { RiAddCircleFill, RiCloseCircleFill, RiLockLine, RiOrganizationChart } from '@remixicon/react'
import { useTranslation } from 'react-i18next'
import Avatar from '../../base/avatar'
import Button from '../../base/button'

type SpecificGroupsOrMembersProps = {
  active: boolean
}

export default function SpecificGroupsOrMembers(props: SpecificGroupsOrMembersProps) {
  const { active } = props
  const { t } = useTranslation()
  if (!active) {
    return <div className='h-[40px] p-3 flex items-center gap-x-2'>
      <RiLockLine className='w-4 h-4 text-text-primary' />
      <p className='system-sm-medium text-text-primary'>{t('app.accessControlDialog.accessItems.specific')}</p>
    </div>
  }

  return <div>
    <div className='flex items-center gap-x-1 p-3'>
      <div className='grow flex items-center gap-x-1'>
        <RiLockLine className='w-4 h-4 text-text-primary' />
        <p className='system-sm-medium text-text-primary'>{t('app.accessControlDialog.accessItems.specific')}</p>
      </div>
      <Button variant='ghost-accent' size='small' className='shrink-0 flex items-center gap-x-0.5'>
        <RiAddCircleFill className='w-4 h-4' />
        <span>{t('common.operation.add')}</span>
      </Button>
    </div>
    <div className='px-1 pb-1'>
      <div className='bg-background-section rounded-lg p-2 flex flex-col gap-y-2'>
        <p className='system-2xs-medium-uppercase text-text-tertiary'>{t('app.accessControlDialog.groups', { count: 1 })}</p>
        <div className='flex flex-row flex-wrap gap-1'>
          <GroupItem />
        </div>
        <p className='system-2xs-medium-uppercase text-text-tertiary'>{t('app.accessControlDialog.members', { count: 4 })}</p>
        <div className='flex flex-row flex-wrap gap-1'>
          <MemberItem />
        </div>
      </div>
    </div>
  </div >
}
function GroupItem() {
  return <BaseItem icon={<RiOrganizationChart className='w-[14px] h-[14px] text-components-avatar-shape-fill-stop-0' />}>
    <p className='system-xs-regular text-text-primary'>Group Name</p>
    <p className='system-xs-regular text-text-tertiary'>7</p>
  </BaseItem>
}

function MemberItem() {
  return <BaseItem icon={<Avatar className='w-[14px] h-[14px]' textClassName='text-[12px]' avatar={null} name='M' />}>
    <p className='system-xs-regular text-text-primary'>Member Name</p>
  </BaseItem>
}

type BaseItemProps = {
  icon: React.ReactNode
  children: React.ReactNode
}
function BaseItem({ icon, children }: BaseItemProps) {
  return <div className='rounded-full border-[0.5px] bg-components-badge-white-to-dark shadow-xs p-1 pr-1.5 group flex items-center flex-row gap-x-1'>
    <div className='w-5 h-5 rounded-full bg-components-icon-bg-blue-solid overflow-hidden'>
      <div className='w-full h-full flex items-center justify-center bg-access-app-icon-mask-bg'>
        {icon}
      </div>
    </div>
    {children}
    <div className='flex items-center justify-center w-4 h-4 cursor-pointer'>
      <RiCloseCircleFill className='w-[14px] h-[14px] text-text-quaternary' />
    </div>
  </div>
}
