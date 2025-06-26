'use client'
import React from 'react'
import type { CrawlerProps } from './base/crawler'
import Crawler from './base/crawler'

type WebsiteCrawlProps = CrawlerProps

const WebsiteCrawl = ({
  nodeId,
  nodeData,
  crawlResult,
  setCrawlResult,
  step,
  setStep,
  checkedCrawlResult,
  onCheckedCrawlResultChange,
  previewIndex,
  onPreview,
  isInPipeline,
}: WebsiteCrawlProps) => {
  return (
    <Crawler
      nodeId={nodeId}
      nodeData={nodeData}
      crawlResult={crawlResult}
      setCrawlResult={setCrawlResult}
      step={step}
      setStep={setStep}
      checkedCrawlResult={checkedCrawlResult}
      onCheckedCrawlResultChange={onCheckedCrawlResultChange}
      previewIndex={previewIndex}
      onPreview={onPreview}
      isInPipeline={isInPipeline}
    />
  )
}
export default WebsiteCrawl
