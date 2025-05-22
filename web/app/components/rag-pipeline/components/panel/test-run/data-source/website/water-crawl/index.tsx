'use client'
import React from 'react'
import type { CrawlResultItem } from '@/models/datasets'
import type { RAGPipelineVariables } from '@/models/pipeline'
import Crawler from '../base/crawler'
import { DataSourceProvider } from '@/models/common'

type WaterCrawlProps = {
  nodeId: string
  variables: RAGPipelineVariables
  checkedCrawlResult: CrawlResultItem[]
  onCheckedCrawlResultChange: (payload: CrawlResultItem[]) => void
  onJobIdChange: (jobId: string) => void
  onPreview?: (payload: CrawlResultItem) => void
}

const WaterCrawl = ({
  nodeId,
  variables,
  checkedCrawlResult,
  onCheckedCrawlResultChange,
  onJobIdChange,
  onPreview,
}: WaterCrawlProps) => {
  return (
    <Crawler
      nodeId={nodeId}
      variables={variables}
      checkedCrawlResult={checkedCrawlResult}
      datasourceProvider={DataSourceProvider.jinaReader}
      onCheckedCrawlResultChange={onCheckedCrawlResultChange}
      onJobIdChange={onJobIdChange}
      onPreview={onPreview}
    />
  )
}
export default React.memo(WaterCrawl)
