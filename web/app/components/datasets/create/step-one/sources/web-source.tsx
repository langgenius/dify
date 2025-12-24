'use client'
import type { WebSourceProps } from '../types'
import { cn } from '@/utils/classnames'
import Website from '../../website'
import NextStepButton from '../common/next-step-button'
import VectorSpaceAlert from '../common/vector-space-alert'

/**
 * Web data source component
 * Handles website crawling for dataset creation
 */
const WebSource = ({
  shouldShowDataSourceTypeList,
  websitePages,
  updateWebsitePages,
  onPreview,
  onWebsiteCrawlProviderChange,
  onWebsiteCrawlJobIdChange,
  crawlOptions,
  onCrawlOptionsChange,
  authedDataSourceList,
  isShowVectorSpaceFull,
  onStepChange,
}: WebSourceProps) => {
  const nextDisabled = isShowVectorSpaceFull || !websitePages.length

  return (
    <>
      <div className={cn('mb-8 w-[640px]', !shouldShowDataSourceTypeList && 'mt-12')}>
        <Website
          onPreview={onPreview}
          checkedCrawlResult={websitePages}
          onCheckedCrawlResultChange={updateWebsitePages}
          onCrawlProviderChange={onWebsiteCrawlProviderChange}
          onJobIdChange={onWebsiteCrawlJobIdChange}
          crawlOptions={crawlOptions}
          onCrawlOptionsChange={onCrawlOptionsChange}
          authedDataSourceList={authedDataSourceList}
        />
      </div>
      <VectorSpaceAlert show={isShowVectorSpaceFull} />
      <NextStepButton disabled={nextDisabled} onClick={onStepChange} />
    </>
  )
}

export default WebSource
