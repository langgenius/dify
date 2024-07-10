'use client'
import React, { useState } from 'react'
import cn from 'classnames'
import { useTranslation } from 'react-i18next'
import { RiCloseLine, RiLock2Line } from '@remixicon/react'
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

  const secretValue = (value: string) => {
    return `${value.slice(0, 2)}********${value.slice(-2)}`
  }

  return (
    <Modal
      isShow={true}
      onClose={() => { }}
      className={cn('max-w-[480px] w-[480px]')}
    >
      <div className='relative pb-6 text-xl font-medium leading-[30px] text-gray-900'>{t('workflow.env.export.title')}</div>
      <div className='absolute right-6 top-6 p-2 cursor-pointer' onClick={onClose}>
        <RiCloseLine className='w-4 h-4 text-gray-500' />
      </div>
      <div className='relative'>
        <table className='w-full border-separate border-spacing-0 border border-gray-200 rounded-lg text-xs shadow-xs'>
          <thead className='text-gray-500'>
            <tr>
              <td width={220} className='h-7 pl-3 border-r border-b border-gray-200'>NAME</td>
              <td className='h-7 pl-3 border-b border-gray-200'>VALUE</td>
            </tr>
          </thead>
          <tbody>
            {envList.map((env, index) => (
              <tr key={env.name}>
                <td className={cn('h-7 pl-3 border-r text-xs leading-4 font-medium', index + 1 !== envList.length && 'border-b')}>
                  <div className='flex gap-1 items-center w-[200px]'>
                    <Env className='shrink-0 w-4 h-4 text-[#7839EE]' />
                    <div className='text-gray-900 truncate'>{env.name}</div>
                    <div className='shrink-0 text-gray-500'>Secret</div>
                    <RiLock2Line className='shrink-0 w-3 h-3 text-gray-500' />
                  </div>
                </td>
                <td className={cn('h-7 pl-3', index + 1 !== envList.length && 'border-b')}>
                  <div className='text-xs text-gray-600 leading-4 truncate'>{secretValue(env.value)}</div>
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
        <div className='text-gray-900 text-xs font-medium cursor-pointer' onClick={() => setExportSecrets(!exportSecrets)}>{t('workflow.env.export.checkbox')}</div>
      </div>
      <div className='flex flex-row-reverse pt-6'>
        {!exportSecrets && (
          <Button className='ml-2' variant='primary' onClick={submit}>{t('workflow.env.export.ignore')}</Button>
        )}
        {exportSecrets && (
          <Button className='ml-2' variant='warning' onClick={submit}>{t('workflow.env.export.export')}</Button>
        )}
        <Button onClick={onClose}>{t('common.operation.cancel')}</Button>
      </div>
    </Modal>
  )
}

export default DSLExportConfirmModal
