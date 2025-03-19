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
      <div className='max-w-[640px] p-6 rounded-2xl bg-workflow-process-bg mt-4'>
        <div className='flex w-12 h-12 items-center justify-center bg-components-card-bg rounded-[10px]
          border-[0.5px] border-components-card-border shadow-lg shadow-shadow-shadow-5 backdrop-blur-[5px]'>
          {currentProvider.emoji}
        </div>
        <div className='mt-2 mb-1 pt-1 pb-3 flex flex-col gap-y-1'>
          <span className='text-text-secondary system-md-semibold'>
            {currentProvider.title}
            <Icon3Dots className='inline relative -top-2.5 -left-1.5' />
          </span>
          <div className='text-text-tertiary system-sm-regular'>
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
