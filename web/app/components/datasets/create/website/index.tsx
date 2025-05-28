'use client'
import type { FC } from 'react'
import React, { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import s from './index.module.css'
import NoData from './no-data'
import Firecrawl from './firecrawl'
import Watercrawl from './watercrawl'
import JinaReader from './jina-reader'
import cn from '@/utils/classnames'
import { useModalContext } from '@/context/modal-context'
import type { CrawlOptions, CrawlResultItem } from '@/models/datasets'
import { fetchDataSources } from '@/service/datasets'
import { type DataSourceItem, DataSourceProvider } from '@/models/common'
import { ENABLE_WEBSITE_FIRECRAWL, ENABLE_WEBSITE_JINAREADER, ENABLE_WEBSITE_WATERCRAWL } from '@/config'

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
      [
        DataSourceProvider.jinaReader,
        DataSourceProvider.fireCrawl,
        DataSourceProvider.waterCrawl,
      ].includes(item.provider),
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

  const source = sources.find(source => source.provider === selectedProvider)

  return (
    <div>
      <div className="mb-4">
        <div className="system-md-medium mb-2 text-text-secondary">
          {t('datasetCreation.stepOne.website.chooseProvider')}
        </div>
        <div className="flex space-x-2">
          {ENABLE_WEBSITE_JINAREADER && <button
            className={cn('flex items-center justify-center rounded-lg px-4 py-2',
              selectedProvider === DataSourceProvider.jinaReader
                ? 'system-sm-medium border-[1.5px] border-components-option-card-option-selected-border bg-components-option-card-option-selected-bg text-text-primary'
                : `system-sm-regular border border-components-option-card-option-border bg-components-option-card-option-bg text-text-secondary
                hover:border-components-option-card-option-border-hover hover:bg-components-option-card-option-bg-hover hover:shadow-xs hover:shadow-shadow-shadow-3`,
            )}
            onClick={() => setSelectedProvider(DataSourceProvider.jinaReader)}
          >
            <span className={cn(s.jinaLogo, 'mr-2')}/>
            <span>Jina Reader</span>
          </button>}
         {ENABLE_WEBSITE_FIRECRAWL && <button
            className={cn('rounded-lg px-4 py-2',
              selectedProvider === DataSourceProvider.fireCrawl
                ? 'system-sm-medium border-[1.5px] border-components-option-card-option-selected-border bg-components-option-card-option-selected-bg text-text-primary'
                : `system-sm-regular border border-components-option-card-option-border bg-components-option-card-option-bg text-text-secondary
                hover:border-components-option-card-option-border-hover hover:bg-components-option-card-option-bg-hover hover:shadow-xs hover:shadow-shadow-shadow-3`,
            )}
            onClick={() => setSelectedProvider(DataSourceProvider.fireCrawl)}
          >
            🔥 Firecrawl
          </button>}
          {ENABLE_WEBSITE_WATERCRAWL && <button
            className={cn('flex items-center justify-center rounded-lg px-4 py-2',
              selectedProvider === DataSourceProvider.waterCrawl
                ? 'system-sm-medium border-[1.5px] border-components-option-card-option-selected-border bg-components-option-card-option-selected-bg text-text-primary'
                : `system-sm-regular border border-components-option-card-option-border bg-components-option-card-option-bg text-text-secondary
                hover:border-components-option-card-option-border-hover hover:bg-components-option-card-option-bg-hover hover:shadow-xs hover:shadow-shadow-shadow-3`,
            )}
            onClick={() => setSelectedProvider(DataSourceProvider.waterCrawl)}
          >
            <span className={cn(s.watercrawlLogo, 'mr-2')}/>
            <span>WaterCrawl</span>
          </button>}
        </div>
      </div>
      {source && selectedProvider === DataSourceProvider.fireCrawl && (
        <Firecrawl
          onPreview={onPreview}
          checkedCrawlResult={checkedCrawlResult}
          onCheckedCrawlResultChange={onCheckedCrawlResultChange}
          onJobIdChange={onJobIdChange}
          crawlOptions={crawlOptions}
          onCrawlOptionsChange={onCrawlOptionsChange}
        />
      )}
      {source && selectedProvider === DataSourceProvider.waterCrawl && (
        <Watercrawl
          onPreview={onPreview}
          checkedCrawlResult={checkedCrawlResult}
          onCheckedCrawlResultChange={onCheckedCrawlResultChange}
          onJobIdChange={onJobIdChange}
          crawlOptions={crawlOptions}
          onCrawlOptionsChange={onCrawlOptionsChange}
        />
      )}
      {source && selectedProvider === DataSourceProvider.jinaReader && (
        <JinaReader
          onPreview={onPreview}
          checkedCrawlResult={checkedCrawlResult}
          onCheckedCrawlResultChange={onCheckedCrawlResultChange}
          onJobIdChange={onJobIdChange}
          crawlOptions={crawlOptions}
          onCrawlOptionsChange={onCrawlOptionsChange}
        />
      )}
      {!source && (
        <NoData onConfig={handleOnConfig} provider={selectedProvider}/>
      )}
    </div>
  )
}
export default React.memo(Website)
