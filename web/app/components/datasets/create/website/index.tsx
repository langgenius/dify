'use client'
import type { FC } from 'react'
import React, { useCallback, useEffect, useState } from 'react'
import NoData from './no-data'
import Firecrawl from './firecrawl'
import { useModalContext } from '@/context/modal-context'
import type { CrawlOptions, CrawlResultItem } from '@/models/datasets'
import { fetchDataSources } from '@/service/datasets'
import { type DataSourceItem, DataSourceProvider } from '@/models/common'

type Props = {
  onPreview: (payload: CrawlResultItem) => void
  checkedCrawlResult: CrawlResultItem[]
  onCheckedCrawlResultChange: (payload: CrawlResultItem[]) => void
  onJobIdChange: (jobId: string) => void
  crawlOptions: CrawlOptions
  onCrawlOptionsChange: (payload: CrawlOptions) => void
}

const Website: FC<Props> = ({
  onPreview,
  checkedCrawlResult,
  onCheckedCrawlResultChange,
  onJobIdChange,
  crawlOptions,
  onCrawlOptionsChange,
}) => {
  const { setShowAccountSettingModal } = useModalContext()
  const [isLoaded, setIsLoaded] = useState(false)
  const [isSetFirecrawlApiKey, setIsSetFirecrawlApiKey] = useState(false)
  const checkSetApiKey = useCallback(async () => {
    const res = await fetchDataSources() as any
    const isFirecrawlSet = res.sources.some((item: DataSourceItem) => item.provider === DataSourceProvider.fireCrawl)
    setIsSetFirecrawlApiKey(isFirecrawlSet)
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
      {isSetFirecrawlApiKey
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
          <NoData onConfig={handleOnConfig} />
        )}
    </div>
  )
}
export default React.memo(Website)
