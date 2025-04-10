'use client'
import { Dialog } from '@headlessui/react'
import { RiBuildingLine, RiGlobalLine } from '@remixicon/react'
import { useTranslation } from 'react-i18next'
import { useCallback, useEffect } from 'react'
import Button from '../../base/button'
import Toast from '../../base/toast'
import AccessControlDialog from './access-control-dialog'
import AccessControlItem from './access-control-item'
import SpecificGroupsOrMembers, { WebAppSSONotEnabledTip } from './specific-groups-or-members'
import useAccessControlStore from './access-control-store'
import { useGlobalPublicStore } from '@/context/global-public-context'
import type { App } from '@/types/app'
import type { Subject } from '@/models/access-control'
import { AccessMode, SubjectType } from '@/models/access-control'
import { useUpdateAccessMode } from '@/service/access-control'

type AccessControlProps = {
  app: App
  onClose: () => void
  onConfirm?: () => void
}

export default function AccessControl(props: AccessControlProps) {
  const { app, onClose, onConfirm } = props
  const { t } = useTranslation()
  const systemFeatures = useGlobalPublicStore(s => s.systemFeatures)
  const setAppId = useAccessControlStore(s => s.setAppId)
  const specificGroups = useAccessControlStore(s => s.specificGroups)
  const specificMembers = useAccessControlStore(s => s.specificMembers)
  const currentMenu = useAccessControlStore(s => s.currentMenu)
  const setCurrentMenu = useAccessControlStore(s => s.setCurrentMenu)
  const hideTip = systemFeatures.enable_web_sso_switch_component && systemFeatures.sso_enforced_for_web

  useEffect(() => {
    setAppId(app.id)
    setCurrentMenu(app.access_mode ?? AccessMode.SPECIFIC_GROUPS_MEMBERS)
  }, [app, setAppId])

  const { isPending, mutateAsync: updateAccessMode } = useUpdateAccessMode()
  const handleConfirm = useCallback(async () => {
    const submitData: {
      appId: string
      accessMode: AccessMode
      subjects?: Pick<Subject, 'subjectId' | 'subjectType'>[]
    } = { appId: app.id, accessMode: currentMenu }
    if (currentMenu === AccessMode.SPECIFIC_GROUPS_MEMBERS) {
      const subjects: Pick<Subject, 'subjectId' | 'subjectType'>[] = []
      specificGroups.forEach((group) => {
        subjects.push({ subjectId: group.id, subjectType: SubjectType.GROUP })
      })
      specificMembers.forEach((member) => {
        subjects.push({
          subjectId: member.id,
          subjectType: SubjectType.ACCOUNT,
        })
      })
      submitData.subjects = subjects
    }
    await updateAccessMode(submitData)
    Toast.notify({ type: 'success', message: t('app.accessControlDialog.updateSuccess') })
    onConfirm?.()
  }, [updateAccessMode, app, specificGroups, specificMembers, t, onConfirm, currentMenu])
  return <AccessControlDialog show onClose={onClose}>
    <div className='flex flex-col gap-y-3'>
      <div className='pt-6 pr-14 pb-3 pl-6'>
        <Dialog.Title className='title-2xl-semi-bold text-text-primary'>{t('app.accessControlDialog.title')}</Dialog.Title>
        <Dialog.Description className='mt-1 system-xs-regular text-text-tertiary'>{t('app.accessControlDialog.description')}</Dialog.Description>
      </div>
      <div className='px-6 pb-3 flex flex-col gap-y-1'>
        <div className='leading-6'>
          <p className='system-sm-medium'>{t('app.accessControlDialog.accessLabel')}</p>
        </div>
        <AccessControlItem type={AccessMode.ORGANIZATION}>
          <div className='flex items-center p-3'>
            <div className='grow flex items-center gap-x-2'>
              <RiBuildingLine className='w-4 h-4 text-text-primary' />
              <p className='system-sm-medium text-text-primary'>{t('app.accessControlDialog.accessItems.organization')}</p>
            </div>
            {!hideTip && <WebAppSSONotEnabledTip />}
          </div>
        </AccessControlItem>
        <AccessControlItem type={AccessMode.SPECIFIC_GROUPS_MEMBERS}>
          <SpecificGroupsOrMembers />
        </AccessControlItem>
        <AccessControlItem type={AccessMode.PUBLIC}>
          <div className='flex items-center p-3 gap-x-2'>
            <RiGlobalLine className='w-4 h-4 text-text-primary' />
            <p className='system-sm-medium text-text-primary'>{t('app.accessControlDialog.accessItems.anyone')}</p>
          </div>
        </AccessControlItem>
      </div>
      <div className='flex items-center justify-end p-6 pt-5 gap-x-2'>
        <Button onClick={onClose}>{t('common.operation.cancel')}</Button>
        <Button disabled={isPending} loading={isPending} variant='primary' onClick={handleConfirm}>{t('common.operation.confirm')}</Button>
      </div>
    </div>
  </AccessControlDialog>
}
