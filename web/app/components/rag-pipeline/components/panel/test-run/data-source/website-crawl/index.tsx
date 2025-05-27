'use client'
import React from 'react'
import type { CrawlResultItem } from '@/models/datasets'
import type { RAGPipelineVariables } from '@/models/pipeline'
import Crawler from './base/crawler'

type WebsiteCrawlProps = {
  nodeId: string
  variables: RAGPipelineVariables
  checkedCrawlResult: CrawlResultItem[]
  onCheckedCrawlResultChange: (payload: CrawlResultItem[]) => void
  onJobIdChange: (jobId: string) => void
  headerInfo: {
    title: string
    docTitle: string
    docLink: string
  }
  onPreview?: (payload: CrawlResultItem) => void
}

const WebsiteCrawl = ({
  nodeId,
  variables,
  checkedCrawlResult,
  headerInfo,
  onCheckedCrawlResultChange,
  onJobIdChange,
  onPreview,
}: WebsiteCrawlProps) => {
  return (
    <Crawler
      nodeId={nodeId}
      variables={variables}
      checkedCrawlResult={checkedCrawlResult}
      headerInfo={headerInfo}
      onCheckedCrawlResultChange={onCheckedCrawlResultChange}
      onJobIdChange={onJobIdChange}
      onPreview={onPreview}
    />
  )
}
export default WebsiteCrawl
