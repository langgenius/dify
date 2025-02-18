'use client'
import type { FC } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import s from './index.module.css'
import { Icon3Dots } from '@/app/components/base/icons/src/vender/line/others'
import Button from '@/app/components/base/button'
import { DataSourceProvider } from '@/models/common'

const I18N_PREFIX = 'datasetCreation.stepOne.website'

type Props = {
  onConfig: () => void
  provider: DataSourceProvider
}

const NoData: FC<Props> = ({
  onConfig,
  provider,
}) => {
  const { t } = useTranslation()

  const providerConfig = {
    [DataSourceProvider.jinaReader]: {
      emoji: <span className={s.jinaLogo} />,
      title: t(`${I18N_PREFIX}.jinaReaderNotConfigured`),
      description: t(`${I18N_PREFIX}.jinaReaderNotConfiguredDescription`),
    },
    [DataSourceProvider.fireCrawl]: {
      emoji: '🔥',
      title: t(`${I18N_PREFIX}.fireCrawlNotConfigured`),
      description: t(`${I18N_PREFIX}.fireCrawlNotConfiguredDescription`),
    },
  }

  const currentProvider = providerConfig[provider]

  return (
    <>
      <div className='mt-4 max-w-[640px] rounded-2xl bg-gray-50 p-6'>
        <div className='flex h-11 w-11 items-center justify-center rounded-xl border-[0.5px] border-gray-100 bg-gray-50 shadow-lg'>
          {currentProvider.emoji}
        </div>
        <div className='my-2'>
          <span className='font-semibold text-gray-700'>{currentProvider.title}<Icon3Dots className='relative -left-1.5 -top-3 inline' /></span>
          <div className='mt-1 pb-3 text-[13px] font-normal text-gray-500'>
            {currentProvider.description}
          </div>
        </div>
        <Button variant='primary' onClick={onConfig}>
          {t(`${I18N_PREFIX}.configure`)}
        </Button>
      </div>
    </>
  )
}
export default React.memo(NoData)
