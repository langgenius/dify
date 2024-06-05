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
import Crawling from './crawling'
import { useModalContext } from '@/context/modal-context'
import type { CrawlOptions, CrawlResultItem } from '@/models/datasets'
import Toast from '@/app/components/base/toast'
import { sleep } from '@/utils'

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

enum Step {
  init = 'init',
  running = 'running',
  finished = 'finished',
}

const FireCrawl: FC<Props> = () => {
  const { t } = useTranslation()
  const [step, setStep] = useState<Step>(Step.running)

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

  const isInit = step === Step.init
  const isCrawlFinished = step === Step.finished
  const isRunning = step === Step.running
  const [crawlResult, setCrawlResult] = useState<CrawlResultItem[]>(mockCrawlResult)
  const [checkedCrawlResult, setCheckedCrawlResult] = useState<CrawlResultItem[]>([])

  const [crawlErrorMsg, setCrawlErrorMsg] = useState('')
  const showCrawlError = step === Step.finished && !!crawlErrorMsg
  const handleRun = useCallback(async (url: string) => {
    const { isValid, errorMsg } = checkValid(url)
    if (!isValid) {
      Toast.notify({
        message: errorMsg!,
        type: 'error',
      })
      return
    }
    setStep(Step.running)
    // TODO: crawl
    await sleep(2000)
    setCrawlResult(mockCrawlResult) // TODO:

    setStep(Step.finished)
    setCrawlErrorMsg('')
  }, [checkValid])

  return (
    <div>
      <Header onSetting={handleSetting} />
      <div className={cn(isInit ? 'pb-4' : 'pb-0', 'mt-2 p-3 rounded-xl border border-gray-200')}>
        <UrlInput onRun={handleRun} isRunning={isRunning} />
        <OptionsWrap
          className={cn('mt-3')}
          isFilledFull={!isInit}
          errorMsg={isCrawlFinished ? crawlErrorMsg : ''}
        >
          {isInit && <Options className='mt-2' payload={crawlOptions} onChange={setCrawlOptions} />}
          {isRunning
            && <Crawling
              className='mt-2'
              crawledNum={8}
              totalNum={10}
            />}
          {isCrawlFinished && (
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
