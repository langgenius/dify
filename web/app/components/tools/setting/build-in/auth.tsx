'use client'
import type { FC } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import Drawer from '@/app/components/base/drawer-plus'
import Button from '@/app/components/base/button'

type Props = {
  config: any
  onCancel: () => void
  onSaved: () => void
}

const SettingAuth: FC<Props> = ({
  config,
  onCancel,
  onSaved,
}) => {
  const { t } = useTranslation()

  return (
    <Drawer
      isShow
      onHide={onCancel}
      title={t('tools.auth.setupModalTitle') as string}
      titleDescription={t('tools.auth.setupModalTitleDescription') as string}
      panelClassName='mt-2 !w-[480px]'
      maxWidthClassName='!max-w-[480px]'
      height='calc(100vh - 16px)'
      contentClassName='!bg-gray-100'
      headerClassName='!border-b-black/5'
      body={
        <div className='px-6 py-3'>
          Forms
          <div className='mt-2 flex justify-between'>
            <Button className='flex items-center h-8 !px-3 !text-[13px] font-medium !text-gray-700'>{t('common.operation.remove')}</Button>
            <div className='flex space-x-2'>
              <Button className='flex items-center h-8 !px-3 !text-[13px] font-medium !text-gray-700'>{t('common.operation.cancel')}</Button>
              <Button className='flex items-center h-8 !px-3 !text-[13px] font-medium' type='primary'>{t('common.operation.save')}</Button>
            </div>
          </div>
        </div>
      }
      isShowMask={true}
      clickOutsideNotOpen={false}
    />
  )
}
export default React.memo(SettingAuth)
