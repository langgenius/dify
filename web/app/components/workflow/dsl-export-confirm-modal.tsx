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
import { noop } from 'lodash-es'

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
      onClose={noop}
      className={cn('w-[480px] max-w-[480px]')}
    >
      <div className='title-2xl-semi-bold relative pb-6 text-text-primary'>{t('workflow.env.export.title')}</div>
      <div className='absolute right-4 top-4 cursor-pointer p-2' onClick={onClose}>
        <RiCloseLine className='h-4 w-4 text-text-tertiary' />
      </div>
      <div className='relative'>
        <table className='radius-md w-full border-separate border-spacing-0 border border-divider-regular shadow-xs'>
          <thead className='system-xs-medium-uppercase text-text-tertiary'>
            <tr>
              <td width={220} className='h-7 border-b border-r border-divider-regular pl-3'>NAME</td>
              <td className='h-7 border-b border-divider-regular pl-3'>VALUE</td>
            </tr>
          </thead>
          <tbody>
            {envList.map((env, index) => (
              <tr key={env.name}>
                <td className={cn('system-xs-medium h-7 border-r pl-3', index + 1 !== envList.length && 'border-b')}>
                  <div className='flex w-[200px] items-center gap-1'>
                    <Env className='h-4 w-4 shrink-0 text-util-colors-violet-violet-600' />
                    <div className='truncate text-text-primary'>{env.name}</div>
                    <div className='shrink-0 text-text-tertiary'>Secret</div>
                    <RiLock2Line className='h-3 w-3 shrink-0 text-text-tertiary' />
                  </div>
                </td>
                <td className={cn('h-7 pl-3', index + 1 !== envList.length && 'border-b')}>
                  <div className='system-xs-regular truncate text-text-secondary'>{env.value}</div>
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
        <div className='system-sm-medium cursor-pointer text-text-primary' onClick={() => setExportSecrets(!exportSecrets)}>{t('workflow.env.export.checkbox')}</div>
      </div>
      <div className='flex flex-row-reverse pt-6'>
        <Button className='ml-2' variant='primary' onClick={submit}>{exportSecrets ? t('workflow.env.export.export') : t('workflow.env.export.ignore')}</Button>
        <Button onClick={onClose}>{t('common.operation.cancel')}</Button>
      </div>
    </Modal>
  )
}

export default DSLExportConfirmModal
