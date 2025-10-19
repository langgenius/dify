'use client'
import { RiAlertFill, RiCloseCircleFill, RiLockLine, RiOrganizationChart } from '@remixicon/react'
import { useTranslation } from 'react-i18next'
import { useCallback, useEffect } from 'react'
import Avatar from '../../base/avatar'
import Tooltip from '../../base/tooltip'
import Loading from '../../base/loading'
import useAccessControlStore from '../../../../context/access-control-store'
import AddMemberOrGroupDialog from './add-member-or-group-pop'
import type { AccessControlAccount, AccessControlGroup } from '@/models/access-control'
import { AccessMode } from '@/models/access-control'
import { useAppWhiteListSubjects } from '@/service/access-control'

export default function SpecificGroupsOrMembers() {
  const currentMenu = useAccessControlStore(s => s.currentMenu)
  const appId = useAccessControlStore(s => s.appId)
  const setSpecificGroups = useAccessControlStore(s => s.setSpecificGroups)
  const setSpecificMembers = useAccessControlStore(s => s.setSpecificMembers)
  const { t } = useTranslation()

  const { isPending, data } = useAppWhiteListSubjects(appId, Boolean(appId) && currentMenu === AccessMode.SPECIFIC_GROUPS_MEMBERS)
  useEffect(() => {
    setSpecificGroups(data?.groups ?? [])
    setSpecificMembers(data?.members ?? [])
  }, [data, setSpecificGroups, setSpecificMembers])

  if (currentMenu !== AccessMode.SPECIFIC_GROUPS_MEMBERS) {
    return <div className='flex items-center p-3'>
      <div className='flex grow items-center gap-x-2'>
        <RiLockLine className='h-4 w-4 text-text-primary' />
        <p className='system-sm-medium text-text-primary'>{t('app.accessControlDialog.accessItems.specific')}</p>
      </div>
    </div>
  }

  return <div>
    <div className='flex items-center gap-x-1 p-3'>
      <div className='flex grow items-center gap-x-1'>
        <RiLockLine className='h-4 w-4 text-text-primary' />
        <p className='system-sm-medium text-text-primary'>{t('app.accessControlDialog.accessItems.specific')}</p>
      </div>
      <div className='flex items-center gap-x-1'>
        <AddMemberOrGroupDialog />
      </div>
    </div>
    <div className='px-1 pb-1'>
      <div className='flex max-h-[400px] flex-col gap-y-2 overflow-y-auto rounded-lg bg-background-section p-2'>
        {isPending ? <Loading /> : <RenderGroupsAndMembers />}
      </div>
    </div>
  </div >
}

function RenderGroupsAndMembers() {
  const { t } = useTranslation()
  const specificGroups = useAccessControlStore(s => s.specificGroups)
  const specificMembers = useAccessControlStore(s => s.specificMembers)
  if (specificGroups.length <= 0 && specificMembers.length <= 0)
    return <div className='px-2 pb-1.5 pt-5'><p className='system-xs-regular text-center text-text-tertiary'>{t('app.accessControlDialog.noGroupsOrMembers')}</p></div>
  return <>
    <p className='system-2xs-medium-uppercase sticky top-0 text-text-tertiary'>{t('app.accessControlDialog.groups', { count: specificGroups.length ?? 0 })}</p>
    <div className='flex flex-row flex-wrap gap-1'>
      {specificGroups.map((group, index) => <GroupItem key={index} group={group} />)}
    </div>
    <p className='system-2xs-medium-uppercase sticky top-0 text-text-tertiary'>{t('app.accessControlDialog.members', { count: specificMembers.length ?? 0 })}</p>
    <div className='flex flex-row flex-wrap gap-1'>
      {specificMembers.map((member, index) => <MemberItem key={index} member={member} />)}
    </div>
  </>
}

type GroupItemProps = {
  group: AccessControlGroup
}
function GroupItem({ group }: GroupItemProps) {
  const specificGroups = useAccessControlStore(s => s.specificGroups)
  const setSpecificGroups = useAccessControlStore(s => s.setSpecificGroups)
  const handleRemoveGroup = useCallback(() => {
    setSpecificGroups(specificGroups.filter(g => g.id !== group.id))
  }, [group, setSpecificGroups, specificGroups])
  return <BaseItem icon={<RiOrganizationChart className='h-[14px] w-[14px] text-components-avatar-shape-fill-stop-0' />}
    onRemove={handleRemoveGroup}>
    <p className='system-xs-regular text-text-primary'>{group.name}</p>
    <p className='system-xs-regular text-text-tertiary'>{group.groupSize}</p>
  </BaseItem>
}

type MemberItemProps = {
  member: AccessControlAccount
}
function MemberItem({ member }: MemberItemProps) {
  const specificMembers = useAccessControlStore(s => s.specificMembers)
  const setSpecificMembers = useAccessControlStore(s => s.setSpecificMembers)
  const handleRemoveMember = useCallback(() => {
    setSpecificMembers(specificMembers.filter(m => m.id !== member.id))
  }, [member, setSpecificMembers, specificMembers])
  return <BaseItem icon={<Avatar className='h-[14px] w-[14px]' textClassName='text-[12px]' avatar={null} name={member.name} />}
    onRemove={handleRemoveMember}>
    <p className='system-xs-regular text-text-primary'>{member.name}</p>
  </BaseItem>
}

type BaseItemProps = {
  icon: React.ReactNode
  children: React.ReactNode
  onRemove?: () => void
}
function BaseItem({ icon, onRemove, children }: BaseItemProps) {
  return <div className='group flex flex-row items-center gap-x-1 rounded-full border-[0.5px] bg-components-badge-white-to-dark p-1 pr-1.5 shadow-xs'>
    <div className='h-5 w-5 overflow-hidden rounded-full bg-components-icon-bg-blue-solid'>
      <div className='bg-access-app-icon-mask-bg flex h-full w-full items-center justify-center'>
        {icon}
      </div>
    </div>
    {children}
    <div className='flex h-4 w-4 cursor-pointer items-center justify-center' onClick={onRemove}>
      <RiCloseCircleFill className='h-[14px] w-[14px] text-text-quaternary' />
    </div>
  </div>
}

export function WebAppSSONotEnabledTip() {
  const { t } = useTranslation()
  return <Tooltip asChild={false} popupContent={t('app.accessControlDialog.webAppSSONotEnabledTip')}>
    <RiAlertFill className='h-4 w-4 shrink-0 text-text-warning-secondary' />
  </Tooltip>
}
