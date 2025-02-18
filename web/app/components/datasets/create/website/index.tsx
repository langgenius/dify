'use client'
import type { FC } from 'react'
import React, { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import s from './index.module.css'
import NoData from './no-data'
import Firecrawl from './firecrawl'
import JinaReader from './jina-reader'
import cn from '@/utils/classnames'
import { useModalContext } from '@/context/modal-context'
import type { CrawlOptions, CrawlResultItem } from '@/models/datasets'
import { fetchDataSources } from '@/service/datasets'
import { type DataSourceItem, DataSourceProvider } from '@/models/common'

type Props = {
  onPreview: (payload: CrawlResultItem) => void
  checkedCrawlResult: CrawlResultItem[]
  onCheckedCrawlResultChange: (payload: CrawlResultItem[]) => void
  onCrawlProviderChange: (provider: DataSourceProvider) => void
  onJobIdChange: (jobId: string) => void
  crawlOptions: CrawlOptions
  onCrawlOptionsChange: (payload: CrawlOptions) => void
}

const Website: FC<Props> = ({
  onPreview,
  checkedCrawlResult,
  onCheckedCrawlResultChange,
  onCrawlProviderChange,
  onJobIdChange,
  crawlOptions,
  onCrawlOptionsChange,
}) => {
  const { t } = useTranslation()
  const { setShowAccountSettingModal } = useModalContext()
  const [isLoaded, setIsLoaded] = useState(false)
  const [selectedProvider, setSelectedProvider] = useState<DataSourceProvider>(DataSourceProvider.jinaReader)
  const [sources, setSources] = useState<DataSourceItem[]>([])

  useEffect(() => {
    onCrawlProviderChange(selectedProvider)
  }, [selectedProvider, onCrawlProviderChange])

  const checkSetApiKey = useCallback(async () => {
    const res = await fetchDataSources() as any
    setSources(res.sources)

    // If users have configured one of the providers, select it.
    const availableProviders = res.sources.filter((item: DataSourceItem) =>
      [DataSourceProvider.jinaReader, DataSourceProvider.fireCrawl].includes(item.provider),
    )

    if (availableProviders.length > 0)
      setSelectedProvider(availableProviders[0].provider)
  }, [])

  useEffect(() => {
    checkSetApiKey().then(() => {
      setIsLoaded(true)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const handleOnConfig = useCallback(() => {
    setShowAccountSettingModal({
      payload: 'data-source',
      onCancelCallback: checkSetApiKey,
    })
  }, [checkSetApiKey, setShowAccountSettingModal])

  if (!isLoaded)
    return null

  return (
    <div>
      <div className="mb-4">
        <div className="mb-2 h-6 font-medium text-gray-700">
          {t('datasetCreation.stepOne.website.chooseProvider')}
        </div>
        <div className="flex space-x-2">
          <button
            className={`flex items-center justify-center rounded-md px-4 py-2 text-sm font-medium ${
              selectedProvider === DataSourceProvider.jinaReader
                ? 'bg-primary-50 text-primary-600'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
            onClick={() => setSelectedProvider(DataSourceProvider.jinaReader)}
          >
            <span className={cn(s.jinaLogo, 'mr-2')} />
            <span>Jina Reader</span>
          </button>
          <button
            className={`rounded-md px-4 py-2 text-sm font-medium ${
              selectedProvider === DataSourceProvider.fireCrawl
                ? 'bg-primary-50 text-primary-600'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
            onClick={() => setSelectedProvider(DataSourceProvider.fireCrawl)}
          >
            🔥 Firecrawl
          </button>
        </div>
      </div>

      {
        selectedProvider === DataSourceProvider.fireCrawl
          ? sources.find(source => source.provider === DataSourceProvider.fireCrawl)
            ? (
              <Firecrawl
                onPreview={onPreview}
                checkedCrawlResult={checkedCrawlResult}
                onCheckedCrawlResultChange={onCheckedCrawlResultChange}
                onJobIdChange={onJobIdChange}
                crawlOptions={crawlOptions}
                onCrawlOptionsChange={onCrawlOptionsChange}
              />
            )
            : (
              <NoData onConfig={handleOnConfig} provider={selectedProvider} />
            )
          : sources.find(source => source.provider === DataSourceProvider.jinaReader)
            ? (
              <JinaReader
                onPreview={onPreview}
                checkedCrawlResult={checkedCrawlResult}
                onCheckedCrawlResultChange={onCheckedCrawlResultChange}
                onJobIdChange={onJobIdChange}
                crawlOptions={crawlOptions}
                onCrawlOptionsChange={onCrawlOptionsChange}
              />
            )
            : (
              <NoData onConfig={handleOnConfig} provider={selectedProvider} />
            )
      }
    </div>
  )
}
export default React.memo(Website)
