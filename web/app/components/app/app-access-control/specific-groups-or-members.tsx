'use client'
import { RiAlertFill, RiCloseCircleFill, RiLockLine, RiOrganizationChart } from '@remixicon/react'
import { useTranslation } from 'react-i18next'
import { useEffect } from 'react'
import Avatar from '../../base/avatar'
import Divider from '../../base/divider'
import Tooltip from '../../base/tooltip'
import Loading from '../../base/loading'
import AddMemberOrGroupDialog from './add-member-or-group-pop'
import useAccessControlStore from './access-control-store'
import { useGlobalPublicStore } from '@/context/global-public-context'
import type { AccessControlAccount, AccessControlGroup } from '@/models/access-control'
import { AccessMode } from '@/models/access-control'
import { useAppWhiteListSubjects } from '@/service/access-control'

export default function SpecificGroupsOrMembers() {
  const currentMenu = useAccessControlStore(s => s.currentMenu)
  const appId = useAccessControlStore(s => s.appId)
  const setSpecificGroups = useAccessControlStore(s => s.setSpecificGroups)
  const setSpecificMembers = useAccessControlStore(s => s.setSpecificMembers)
  const { t } = useTranslation()
  const systemFeatures = useGlobalPublicStore(s => s.systemFeatures)
  const hideTip = systemFeatures.webapp_auth.enable

  const { isPending, data } = useAppWhiteListSubjects(appId, Boolean(appId) && currentMenu === AccessMode.SPECIFIC_GROUPS_MEMBERS)
  useEffect(() => {
    setSpecificGroups(data?.groups ?? [])
    setSpecificMembers(data?.members ?? [])
  }, [data, setSpecificGroups, setSpecificMembers])

  if (currentMenu !== AccessMode.SPECIFIC_GROUPS_MEMBERS) {
    return <div className='flex items-center p-3'>
      <div className='grow flex items-center gap-x-2'>
        <RiLockLine className='w-4 h-4 text-text-primary' />
        <p className='system-sm-medium text-text-primary'>{t('app.accessControlDialog.accessItems.specific')}</p>
      </div>
      {!hideTip && <WebAppSSONotEnabledTip />}
    </div>
  }

  return <div>
    <div className='flex items-center gap-x-1 p-3'>
      <div className='grow flex items-center gap-x-1'>
        <RiLockLine className='w-4 h-4 text-text-primary' />
        <p className='system-sm-medium text-text-primary'>{t('app.accessControlDialog.accessItems.specific')}</p>
      </div>
      <div className='flex items-center gap-x-1'>
        {!hideTip && <>
          <WebAppSSONotEnabledTip />
          <Divider className='h-[14px] ml-2 mr-0' type="vertical" />
        </>}
        <AddMemberOrGroupDialog />
      </div>
    </div>
    <div className='px-1 pb-1'>
      <div className='bg-background-section rounded-lg p-2 flex flex-col gap-y-2 max-h-[400px] overflow-y-auto'>
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
    return <div className='px-2 pt-5 pb-1.5'><p className='system-xs-regular text-text-tertiary text-center'>{t('app.accessControlDialog.noGroupsOrMembers')}</p></div>
  return <>
    <p className='system-2xs-medium-uppercase text-text-tertiary sticky top-0'>{t('app.accessControlDialog.groups', { count: specificGroups.length ?? 0 })}</p>
    <div className='flex flex-row flex-wrap gap-1'>
      {specificGroups.map((group, index) => <GroupItem key={index} group={group} />)}
    </div>
    <p className='system-2xs-medium-uppercase text-text-tertiary sticky top-0'>{t('app.accessControlDialog.members', { count: specificMembers.length ?? 0 })}</p>
    <div className='flex flex-row flex-wrap gap-1'>
      {specificMembers.map((member, index) => <MemberItem key={index} member={member} />)}
    </div>
  </>
}

type GroupItemProps = {
  group: AccessControlGroup
}
function GroupItem({ group }: GroupItemProps) {
  return <BaseItem icon={<RiOrganizationChart className='w-[14px] h-[14px] text-components-avatar-shape-fill-stop-0' />}>
    <p className='system-xs-regular text-text-primary'>{group.name}</p>
    <p className='system-xs-regular text-text-tertiary'>{group.groupSize}</p>
  </BaseItem>
}

type MemberItemProps = {
  member: AccessControlAccount
}
function MemberItem({ member }: MemberItemProps) {
  return <BaseItem icon={<Avatar className='w-[14px] h-[14px]' textClassName='text-[12px]' avatar={null} name={member.name} />}>
    <p className='system-xs-regular text-text-primary'>{member.name}</p>
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

export function WebAppSSONotEnabledTip() {
  const { t } = useTranslation()
  return <Tooltip asChild={false} popupContent={t('app.accessControlDialog.webAppSSONotEnabledTip')}>
    <RiAlertFill className='w-4 h-4 text-text-warning-secondary shrink-0' />
  </Tooltip>
}
