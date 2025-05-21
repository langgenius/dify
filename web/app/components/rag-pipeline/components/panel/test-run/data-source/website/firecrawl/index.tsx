'use client'
import React from 'react'
import type { CrawlResultItem } from '@/models/datasets'
import type { RAGPipelineVariables } from '@/models/pipeline'
import Crawler from '../base/crawler'
import { DataSourceProvider } from '@/models/common'

type FireCrawlProps = {
  nodeId: string
  variables: RAGPipelineVariables
  checkedCrawlResult: CrawlResultItem[]
  onCheckedCrawlResultChange: (payload: CrawlResultItem[]) => void
  onJobIdChange: (jobId: string) => void
}

const FireCrawl = ({
  nodeId,
  variables,
  checkedCrawlResult,
  onCheckedCrawlResultChange,
  onJobIdChange,
}: FireCrawlProps) => {
  return (
    <Crawler
      nodeId={nodeId}
      variables={variables}
      checkedCrawlResult={checkedCrawlResult}
      datasourceProvider={DataSourceProvider.fireCrawl}
      onCheckedCrawlResultChange={onCheckedCrawlResultChange}
      onJobIdChange={onJobIdChange}
    />
  )
}
export default FireCrawl
