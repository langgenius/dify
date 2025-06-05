'use client'
import React from 'react'
import type { CrawlResultItem } from '@/models/datasets'
import Crawler from './base/crawler'

type WebsiteCrawlProps = {
  nodeId: string
  checkedCrawlResult: CrawlResultItem[]
  onCheckedCrawlResultChange: (payload: CrawlResultItem[]) => void
  onJobIdChange: (jobId: string) => void
  headerInfo: {
    title: string
    docTitle: string
    docLink: string
  }
  onPreview?: (payload: CrawlResultItem) => void
  usingPublished?: boolean
}

const WebsiteCrawl = ({
  nodeId,
  checkedCrawlResult,
  headerInfo,
  onCheckedCrawlResultChange,
  onJobIdChange,
  onPreview,
  usingPublished,
}: WebsiteCrawlProps) => {
  return (
    <Crawler
      nodeId={nodeId}
      checkedCrawlResult={checkedCrawlResult}
      headerInfo={headerInfo}
      onCheckedCrawlResultChange={onCheckedCrawlResultChange}
      onJobIdChange={onJobIdChange}
      onPreview={onPreview}
      usingPublished={usingPublished}
    />
  )
}
export default WebsiteCrawl
