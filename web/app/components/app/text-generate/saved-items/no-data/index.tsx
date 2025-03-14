'use client'
import type { FC } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import {
  RiAddLine,
  RiBookmark3Line,
} from '@remixicon/react'
import Button from '@/app/components/base/button'
export type INoDataProps = {
  onStartCreateContent: () => void
}

const NoData: FC<INoDataProps> = ({
  onStartCreateContent,
}) => {
  const { t } = useTranslation()

  return (
    <div className='p-6 rounded-xl bg-background-section-burn '>
      <div className='flex items-center justify-center w-10 h-10 border-[0.5px] border-components-card-border bg-components-card-bg-alt rounded-[10px] shadow-lg backdrop-blur-sm'>
        <RiBookmark3Line className='w-4 h-4 text-text-accent'/>
      </div>
      <div className='mt-3'>
        <span className='text-text-secondary system-xl-semibold'>{t('share.generation.savedNoData.title')}</span>
      </div>
      <div className='mt-1 text-text-tertiary system-sm-regular'>
        {t('share.generation.savedNoData.description')}
      </div>
      <Button
        variant='primary'
        className='mt-3'
        onClick={onStartCreateContent}
      >
        <RiAddLine className='mr-1 w-4 h-4' />
        <span>{t('share.generation.savedNoData.startCreateContent')}</span>
      </Button>
    </div>
  )
}

export default React.memo(NoData)
