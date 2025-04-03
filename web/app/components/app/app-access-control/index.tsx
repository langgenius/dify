'use client'
import { Dialog } from '@headlessui/react'
import { RiBuildingLine, RiGlobalLine } from '@remixicon/react'
import { useTranslation } from 'react-i18next'
import Button from '../../base/button'
import AccessControlDialog from './access-control-dialog'
import AccessControlItem from './access-control-item'
import SpecificGroupsOrMembers from './specific-groups-or-members'

type AccessControlProps = {
  onClose: () => void
}

export default function AccessControl(props: AccessControlProps) {
  const { t } = useTranslation()
  return <AccessControlDialog show onClose={props.onClose}>
    <div className='flex flex-col gap-y-3'>
      <div className='pt-6 pr-14 pb-3 pl-6'>
        <Dialog.Title className='title-2xl-semi-bold text-text-primary'>{t('app.accessControlDialog.title')}</Dialog.Title>
        <Dialog.Description className='mt-1 system-xs-regular text-text-tertiary'>{t('app.accessControlDialog.description')}</Dialog.Description>
      </div>
      <div className='px-6 pb-3 flex flex-col gap-y-1'>
        <div className='leading-6'>
          <p className='system-sm-medium'>{t('app.accessControlDialog.accessLabel')}</p>
        </div>
        <AccessControlItem active={false}>
          <div className='h-[40px] p-3 flex items-center gap-x-2'>
            <RiBuildingLine className='w-4 h-4 text-text-primary' />
            <p className='system-sm-medium text-text-primary'>{t('app.accessControlDialog.accessItems.organization')}</p>
          </div>
        </AccessControlItem>
        <AccessControlItem active={true}>
          <SpecificGroupsOrMembers active={true} />
        </AccessControlItem>
        <AccessControlItem active={false}>
          <div className='h-[40px] p-3 flex items-center gap-x-2'>
            <RiGlobalLine className='w-4 h-4 text-text-primary' />
            <p className='system-sm-medium text-text-primary'>{t('app.accessControlDialog.accessItems.anyone')}</p>
          </div>
        </AccessControlItem>
      </div>
      <div className='flex items-center justify-end p-6 pt-5 gap-x-2'>
        <Button onClick={props.onClose}>{t('common.operation.cancel')}</Button>
        <Button variant='primary'>{t('common.operation.confirm')}</Button>
      </div>
    </div>
  </AccessControlDialog>
}
