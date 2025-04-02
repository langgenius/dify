'use client'
import { Dialog } from '@headlessui/react'
import { useTranslation } from 'react-i18next'
import Button from '../../base/button'
import AccessControlDialog from './access-control-dialog'

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

      </div>
      <div className='flex items-center justify-end p-6 pt-5 gap-x-2'>
        <Button onClick={props.onClose}>{t('common.operation.cancel')}</Button>
        <Button variant='primary'>{t('common.operation.confirm')}</Button>
      </div>
    </div>
  </AccessControlDialog>
}
