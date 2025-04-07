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
    <div className='rounded-xl bg-background-section-burn p-6 '>
      <div className='flex h-10 w-10 items-center justify-center rounded-[10px] border-[0.5px] border-components-card-border bg-components-card-bg-alt shadow-lg backdrop-blur-sm'>
        <RiBookmark3Line className='h-4 w-4 text-text-accent'/>
      </div>
      <div className='mt-3'>
        <span className='system-xl-semibold text-text-secondary'>{t('share.generation.savedNoData.title')}</span>
      </div>
      <div className='system-sm-regular mt-1 text-text-tertiary'>
        {t('share.generation.savedNoData.description')}
      </div>
      <Button
        variant='primary'
        className='mt-3'
        onClick={onStartCreateContent}
      >
        <RiAddLine className='mr-1 h-4 w-4' />
        <span>{t('share.generation.savedNoData.startCreateContent')}</span>
      </Button>
    </div>
  )
}

export default React.memo(NoData)
