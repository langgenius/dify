'use client'
import type { FC } from 'react'
import React, { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import cn from 'classnames'
import Header from './header'
import UrlInput from './base/url-input'
import OptionsWrap from './base/options-wrap'
import Options from './options'
import mockCrawlResult from './mock-crawl-result'
import CrawledResult from './crawled-result'
import { useModalContext } from '@/context/modal-context'
import type { CrawlOptions, CrawlResultItem } from '@/models/datasets'
import Toast from '@/app/components/base/toast'

const ERROR_I18N_PREFIX = 'common.errorMsg'
const I18N_PREFIX = 'datasetCreation.stepOne.website'

// const testCrawlErrorMsg = 'Firecrawl currently does not support social media scraping due to policy restrictions. We are actively working on building support for it.'

type Props = {

}
const DEFAULT_CRAWL_OPTIONS: CrawlOptions = {
  crawl_sub_pages: true,
  only_main_content: true,
  includes: '',
  excludes: '',
  limit: 10,
  max_depth: 2,
}

const FireCrawl: FC<Props> = () => {
  const { t } = useTranslation()

  const { setShowAccountSettingModal } = useModalContext()
  const handleSetting = useCallback(() => {
    setShowAccountSettingModal({
      payload: 'data-source',
    })
  }, [setShowAccountSettingModal])

  const [crawlOptions, setCrawlOptions] = useState<CrawlOptions>(DEFAULT_CRAWL_OPTIONS)
  const checkValid = useCallback((url: string) => {
    let errorMsg = ''
    if (!url) {
      errorMsg = t(`${ERROR_I18N_PREFIX}.fieldRequired`, {
        field: 'url',
      })
    }

    if (!errorMsg && !((url.startsWith('http://') || url.startsWith('https://'))))
      errorMsg = t(`${ERROR_I18N_PREFIX}.urlError`)

    if (!errorMsg && (crawlOptions.limit === null || crawlOptions.limit === undefined || crawlOptions.limit === '')) {
      errorMsg = t(`${ERROR_I18N_PREFIX}.fieldRequired`, {
        field: t(`${I18N_PREFIX}.limit`),
      })
    }

    if (!errorMsg && (crawlOptions.max_depth === null || crawlOptions.max_depth === undefined || crawlOptions.max_depth === '')) {
      errorMsg = t(`${ERROR_I18N_PREFIX}.fieldRequired`, {
        field: t(`${I18N_PREFIX}.maxDepth`),
      })
    }

    return {
      isValid: !errorMsg,
      errorMsg,
    }
  }, [crawlOptions, t])

  const [isCrawlFinished, setIsCrawlFinished] = useState(true)
  const [crawlResult, setCrawlResult] = useState<CrawlResultItem[]>(mockCrawlResult)
  const [checkedCrawlResult, setCheckedCrawlResult] = useState<CrawlResultItem[]>([])

  const [crawlErrorMsg, setCrawlErrorMsg] = useState('')
  const showCrawlError = isCrawlFinished && !!crawlErrorMsg
  const handleRun = useCallback((url: string) => {
    setIsCrawlFinished(false)
    const { isValid, errorMsg } = checkValid(url)
    if (!isValid) {
      Toast.notify({
        message: errorMsg!,
        type: 'error',
      })
      return
    }
    // TODO: crawl
    setIsCrawlFinished(true)
    setCrawlErrorMsg('')
  }, [checkValid])

  return (
    <div>
      <Header onSetting={handleSetting} />
      <div className={cn(!showCrawlError ? 'pb-4' : 'pb-0', 'mt-2 p-3 rounded-xl border border-gray-200')}>
        <UrlInput onRun={handleRun} />
        <OptionsWrap className='mt-3' errorMsg={isCrawlFinished ? crawlErrorMsg : ''} >
          {!isCrawlFinished
            ? (
              <Options className='mt-2' payload={crawlOptions} onChange={setCrawlOptions} />
            )
            : (
              <CrawledResult
                list={crawlResult}
                checkedList={checkedCrawlResult}
                onSelectedChange={setCheckedCrawlResult}
              />
            )}
        </OptionsWrap>
      </div>
    </div>
  )
}
export default React.memo(FireCrawl)
