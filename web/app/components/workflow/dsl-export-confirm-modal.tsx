'use client'
import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { RiCloseLine, RiLock2Line } from '@remixicon/react'
import cn from '@/utils/classnames'
import { Env } from '@/app/components/base/icons/src/vender/line/others'
import Modal from '@/app/components/base/modal'
import Checkbox from '@/app/components/base/checkbox'
import Button from '@/app/components/base/button'
import type { EnvironmentVariable } from '@/app/components/workflow/types'

export type DSLExportConfirmModalProps = {
  envList: EnvironmentVariable[]
  onConfirm: (state: boolean) => void
  onClose: () => void
}

const DSLExportConfirmModal = ({
  envList = [],
  onConfirm,
  onClose,
}: DSLExportConfirmModalProps) => {
  const { t } = useTranslation()

  const [exportSecrets, setExportSecrets] = useState<boolean>(false)

  const submit = () => {
    onConfirm(exportSecrets)
    onClose()
  }

  return (
    <Modal
      isShow={true}
      onClose={() => { }}
      className={cn('max-w-[480px] w-[480px]')}
    >
      <div className='relative pb-6 title-2xl-semi-bold text-text-primary'>{t('workflow.env.export.title')}</div>
      <div className='absolute right-4 top-4 p-2 cursor-pointer' onClick={onClose}>
        <RiCloseLine className='w-4 h-4 text-text-tertiary' />
      </div>
      <div className='relative'>
        <table className='w-full border-separate border-spacing-0 border border-divider-regular radius-md shadow-xs'>
          <thead className='system-xs-medium-uppercase text-text-tertiary'>
            <tr>
              <td width={220} className='h-7 pl-3 border-r border-b border-divider-regular'>NAME</td>
              <td className='h-7 pl-3 border-b border-divider-regular'>VALUE</td>
            </tr>
          </thead>
          <tbody>
            {envList.map((env, index) => (
              <tr key={env.name}>
                <td className={cn('h-7 pl-3 border-r system-xs-medium', index + 1 !== envList.length && 'border-b')}>
                  <div className='flex gap-1 items-center w-[200px]'>
                    <Env className='shrink-0 w-4 h-4 text-util-colors-violet-violet-600' />
                    <div className='text-text-primary truncate'>{env.name}</div>
                    <div className='shrink-0 text-text-tertiary'>Secret</div>
                    <RiLock2Line className='shrink-0 w-3 h-3 text-text-tertiary' />
                  </div>
                </td>
                <td className={cn('h-7 pl-3', index + 1 !== envList.length && 'border-b')}>
                  <div className='system-xs-regular text-text-secondary truncate'>{env.value}</div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className='mt-4 flex gap-2'>
        <Checkbox
          className='shrink-0'
          checked={exportSecrets}
          onCheck={() => setExportSecrets(!exportSecrets)}
        />
        <div className='text-text-primary system-sm-medium cursor-pointer' onClick={() => setExportSecrets(!exportSecrets)}>{t('workflow.env.export.checkbox')}</div>
      </div>
      <div className='flex flex-row-reverse pt-6'>
        <Button className='ml-2' variant='primary' onClick={submit}>{exportSecrets ? t('workflow.env.export.export') : t('workflow.env.export.ignore')}</Button>
        <Button onClick={onClose}>{t('common.operation.cancel')}</Button>
      </div>
    </Modal>
  )
}

export default DSLExportConfirmModal
