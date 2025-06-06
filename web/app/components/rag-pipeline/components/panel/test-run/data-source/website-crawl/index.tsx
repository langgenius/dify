'use client'
import React from 'react'
import type { CrawlResultItem } from '@/models/datasets'
import Crawler from './base/crawler'

type WebsiteCrawlProps = {
  nodeId: string
  checkedCrawlResult: CrawlResultItem[]
  onCheckedCrawlResultChange: (payload: CrawlResultItem[]) => void
  headerInfo: {
    title: string
    docTitle: string
    docLink: string
  }
  onPreview?: (payload: CrawlResultItem) => void
  isInPipeline?: boolean
}

const WebsiteCrawl = ({
  nodeId,
  checkedCrawlResult,
  headerInfo,
  onCheckedCrawlResultChange,
  onPreview,
  isInPipeline,
}: WebsiteCrawlProps) => {
  return (
    <Crawler
      nodeId={nodeId}
      checkedCrawlResult={checkedCrawlResult}
      headerInfo={headerInfo}
      onCheckedCrawlResultChange={onCheckedCrawlResultChange}
      onPreview={onPreview}
      isInPipeline={isInPipeline}
    />
  )
}
export default WebsiteCrawl
