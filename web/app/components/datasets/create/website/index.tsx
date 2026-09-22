'use client'
import type { FC } from 'react'
import type { DataSourceAuth } from '@/app/components/header/account-setting/data-source-page-new/types'
import type { CrawlOptions, CrawlResultItem } from '@/models/datasets'
import { cn } from '@langgenius/dify-ui/cn'
import { RadioGroup, RadioItem } from '@langgenius/dify-ui/radio-group'
import { useQueryState } from 'nuqs'
import * as React from 'react'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  settingsQueryParamName,
  settingsQueryParser,
} from '@/app/components/header/account-setting/query-params'
import {
  ENABLE_WEBSITE_FIRECRAWL,
  ENABLE_WEBSITE_JINAREADER,
  ENABLE_WEBSITE_WATERCRAWL,
} from '@/config'
import { DataSourceProvider } from '@/models/common'
import Firecrawl from './firecrawl'
import s from './index.module.css'
import JinaReader from './jina-reader'
import NoData from './no-data'
import Watercrawl from './watercrawl'

type Props = Readonly<{
  onPreview: (payload: CrawlResultItem) => void
  checkedCrawlResult: CrawlResultItem[]
  onCheckedCrawlResultChange: (payload: CrawlResultItem[]) => void
  onCrawlProviderChange: (provider: DataSourceProvider) => void
  onJobIdChange: (jobId: string) => void
  crawlOptions: CrawlOptions
  onCrawlOptionsChange: (payload: CrawlOptions) => void
  authedDataSourceList: DataSourceAuth[]
}>

const Website: FC<Props> = ({
  onPreview,
  checkedCrawlResult,
  onCheckedCrawlResultChange,
  onCrawlProviderChange,
  onJobIdChange,
  crawlOptions,
  onCrawlOptionsChange,
  authedDataSourceList,
}) => {
  const { t } = useTranslation()
  const providerLabelId = React.useId()
  const [, setSettingsDestination] = useQueryState(settingsQueryParamName, settingsQueryParser)
  const [selectedProvider, setSelectedProvider] = useState<DataSourceProvider>(
    DataSourceProvider.jinaReader,
  )

  const availableProviders = useMemo(
    () =>
      authedDataSourceList.filter((item) => {
        return (
          [
            DataSourceProvider.jinaReader,
            DataSourceProvider.fireCrawl,
            DataSourceProvider.waterCrawl,
          ].includes(item.provider as DataSourceProvider) && item.credentials_list.length > 0
        )
      }),
    [authedDataSourceList],
  )

  const handleOnConfig = useCallback(() => {
    setSettingsDestination('data-source')
  }, [setSettingsDestination])

  const source = availableProviders.find((source) => source.provider === selectedProvider)

  return (
    <div>
      <div className="mb-4">
        <h2 id={providerLabelId} className="mb-2 system-md-medium text-text-secondary">
          {t(($) => $['stepOne.website.chooseProvider'], { ns: 'datasetCreation' })}
        </h2>
        <RadioGroup
          aria-labelledby={providerLabelId}
          value={selectedProvider}
          onValueChange={(provider: DataSourceProvider) => {
            setSelectedProvider(provider)
            onCrawlProviderChange(provider)
          }}
          className="flex flex-wrap gap-2"
        >
          {ENABLE_WEBSITE_JINAREADER && (
            <RadioItem
              value={DataSourceProvider.jinaReader}
              className={cn(
                'flex items-center justify-center rounded-lg px-4 py-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-components-input-border-active',
                selectedProvider === DataSourceProvider.jinaReader
                  ? 'border-[1.5px] border-components-option-card-option-selected-border bg-components-option-card-option-selected-bg system-sm-medium text-text-primary'
                  : `border border-components-option-card-option-border bg-components-option-card-option-bg system-sm-regular text-text-secondary hover:border-components-option-card-option-border-hover hover:bg-components-option-card-option-bg-hover hover:shadow-xs hover:shadow-shadow-shadow-3`,
              )}
            >
              <span className={cn(s.jinaLogo, 'mr-2')} />
              <span>Jina Reader</span>
            </RadioItem>
          )}
          {ENABLE_WEBSITE_FIRECRAWL && (
            <RadioItem
              value={DataSourceProvider.fireCrawl}
              className={cn(
                'rounded-lg px-4 py-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-components-input-border-active',
                selectedProvider === DataSourceProvider.fireCrawl
                  ? 'border-[1.5px] border-components-option-card-option-selected-border bg-components-option-card-option-selected-bg system-sm-medium text-text-primary'
                  : `border border-components-option-card-option-border bg-components-option-card-option-bg system-sm-regular text-text-secondary hover:border-components-option-card-option-border-hover hover:bg-components-option-card-option-bg-hover hover:shadow-xs hover:shadow-shadow-shadow-3`,
              )}
            >
              🔥 Firecrawl
            </RadioItem>
          )}
          {ENABLE_WEBSITE_WATERCRAWL && (
            <RadioItem
              value={DataSourceProvider.waterCrawl}
              className={cn(
                'flex items-center justify-center rounded-lg px-4 py-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-components-input-border-active',
                selectedProvider === DataSourceProvider.waterCrawl
                  ? 'border-[1.5px] border-components-option-card-option-selected-border bg-components-option-card-option-selected-bg system-sm-medium text-text-primary'
                  : `border border-components-option-card-option-border bg-components-option-card-option-bg system-sm-regular text-text-secondary hover:border-components-option-card-option-border-hover hover:bg-components-option-card-option-bg-hover hover:shadow-xs hover:shadow-shadow-shadow-3`,
              )}
            >
              <span className={cn(s.watercrawlLogo, 'mr-2')} />
              <span>WaterCrawl</span>
            </RadioItem>
          )}
        </RadioGroup>
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
      {!source && <NoData onConfig={handleOnConfig} provider={selectedProvider} />}
    </div>
  )
}
export default React.memo(Website)
