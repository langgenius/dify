'use client'
import type { FC } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import s from './index.module.css'
import { Icon3Dots } from '@/app/components/base/icons/src/vender/line/others'
import Button from '@/app/components/base/button'
import { DataSourceProvider } from '@/models/common'
import { ENABLE_WEBSITE_FIRECRAWL, ENABLE_WEBSITE_JINAREADER, ENABLE_WEBSITE_WATERCRAWL } from '@/config'

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
    [DataSourceProvider.jinaReader]: ENABLE_WEBSITE_JINAREADER ? {
      emoji: <span className={s.jinaLogo} />,
      title: t(`${I18N_PREFIX}.jinaReaderNotConfigured`),
      description: t(`${I18N_PREFIX}.jinaReaderNotConfiguredDescription`),
    } : null,
    [DataSourceProvider.fireCrawl]: ENABLE_WEBSITE_FIRECRAWL ? {
      emoji: '🔥',
      title: t(`${I18N_PREFIX}.fireCrawlNotConfigured`),
      description: t(`${I18N_PREFIX}.fireCrawlNotConfiguredDescription`),
    } : null,
    [DataSourceProvider.waterCrawl]: ENABLE_WEBSITE_WATERCRAWL ? {
      emoji: '💧',
      title: t(`${I18N_PREFIX}.waterCrawlNotConfigured`),
      description: t(`${I18N_PREFIX}.waterCrawlNotConfiguredDescription`),
    } : null,
  }

  const currentProvider = providerConfig[provider] || providerConfig[DataSourceProvider.jinaReader]

  if (!currentProvider) return null

  return (
    <>
      <div className='mt-4 max-w-[640px] rounded-2xl bg-workflow-process-bg p-6'>
        <div className='flex h-12 w-12 items-center justify-center rounded-[10px] border-[0.5px]
          border-components-card-border bg-components-card-bg shadow-lg shadow-shadow-shadow-5 backdrop-blur-[5px]'>
          {currentProvider.emoji}
        </div>
        <div className='mb-1 mt-2 flex flex-col gap-y-1 pb-3 pt-1'>
          <span className='system-md-semibold text-text-secondary'>
            {currentProvider.title}
            <Icon3Dots className='relative -left-1.5 -top-2.5 inline' />
          </span>
          <div className='system-sm-regular text-text-tertiary'>
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
