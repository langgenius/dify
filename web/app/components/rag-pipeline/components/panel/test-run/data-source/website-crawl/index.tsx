'use client'
import React from 'react'
import type { CrawlerProps } from './base/crawler'
import Crawler from './base/crawler'

type WebsiteCrawlProps = CrawlerProps

const WebsiteCrawl = ({
  nodeId,
  crawlResult,
  setCrawlResult,
  step,
  setStep,
  checkedCrawlResult,
  headerInfo,
  onCheckedCrawlResultChange,
  previewIndex,
  onPreview,
  isInPipeline,
}: WebsiteCrawlProps) => {
  return (
    <Crawler
      nodeId={nodeId}
      crawlResult={crawlResult}
      setCrawlResult={setCrawlResult}
      step={step}
      setStep={setStep}
      checkedCrawlResult={checkedCrawlResult}
      headerInfo={headerInfo}
      onCheckedCrawlResultChange={onCheckedCrawlResultChange}
      previewIndex={previewIndex}
      onPreview={onPreview}
      isInPipeline={isInPipeline}
    />
  )
}
export default WebsiteCrawl
