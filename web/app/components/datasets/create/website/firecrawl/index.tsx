'use client'
import type { FC } from 'react'
import type { CrawlOptions, CrawlResultItem } from '@/models/datasets'
import * as React from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from '@/app/components/base/ui/toast'
import { ACCOUNT_SETTING_TAB } from '@/app/components/header/account-setting/constants'
import { useModalContextSelector } from '@/context/modal-context'
import { checkFirecrawlTaskStatus, createFirecrawlTask } from '@/service/datasets'
import { sleep } from '@/utils'
import CrawledResult from '../base/crawled-result'
import Crawling from '../base/crawling'
import ErrorMessage from '../base/error-message'
import Header from '../base/header'
import OptionsWrap from '../base/options-wrap'
import UrlInput from '../base/url-input'
import Options from './options'

const ERROR_I18N_PREFIX = 'errorMsg'
const I18N_PREFIX = 'stepOne.website'
type Props = {
  onPreview: (payload: CrawlResultItem) => void
  checkedCrawlResult: CrawlResultItem[]
  onCheckedCrawlResultChange: (payload: CrawlResultItem[]) => void
  onJobIdChange: (jobId: string) => void
  crawlOptions: CrawlOptions
  onCrawlOptionsChange: (payload: CrawlOptions) => void
}
enum Step {
  init = 'init',
  running = 'running',
  finished = 'finished',
}
type CrawlState = {
  current: number
  total: number
  data: CrawlResultItem[]
  time_consuming: number | string
}
type CrawlFinishedResult = {
  isCancelled?: boolean
  isError: boolean
  errorMessage?: string
  data: Partial<CrawlState> & {
    data: CrawlResultItem[]
  }
}
const FireCrawl: FC<Props> = ({ onPreview, checkedCrawlResult, onCheckedCrawlResultChange, onJobIdChange, crawlOptions, onCrawlOptionsChange }) => {
  const { t } = useTranslation()
  const [step, setStep] = useState<Step>(Step.init)
  const [controlFoldOptions, setControlFoldOptions] = useState<number>(0)
  const isMountedRef = useRef(true)
  useEffect(() => {
    if (step !== Step.init)
      setControlFoldOptions(Date.now())
  }, [step])
  useEffect(() => {
    return () => {
      isMountedRef.current = false
    }
  }, [])
  const setShowAccountSettingModal = useModalContextSelector(s => s.setShowAccountSettingModal)
  const handleSetting = useCallback(() => {
    setShowAccountSettingModal({
      payload: ACCOUNT_SETTING_TAB.DATA_SOURCE,
    })
  }, [setShowAccountSettingModal])
  const checkValid = useCallback((url: string) => {
    let errorMsg = ''
    if (!url) {
      errorMsg = t(`${ERROR_I18N_PREFIX}.fieldRequired`, {
        ns: 'common',
        field: 'url',
      })
    }
    if (!errorMsg && !((url.startsWith('http://') || url.startsWith('https://'))))
      errorMsg = t(`${ERROR_I18N_PREFIX}.urlError`, { ns: 'common' })
    if (!errorMsg && (crawlOptions.limit === null || crawlOptions.limit === undefined || crawlOptions.limit === '')) {
      errorMsg = t(`${ERROR_I18N_PREFIX}.fieldRequired`, {
        ns: 'common',
        field: t(`${I18N_PREFIX}.limit`, { ns: 'datasetCreation' }),
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
  const [crawlResult, setCrawlResult] = useState<CrawlState | undefined>(undefined)
  const [crawlErrorMessage, setCrawlErrorMessage] = useState('')
  const showError = isCrawlFinished && crawlErrorMessage
  const waitForCrawlFinished = useCallback(async (jobId: string): Promise<CrawlFinishedResult> => {
    const cancelledResult: CrawlFinishedResult = {
      isCancelled: true,
      isError: false,
      data: {
        data: [],
      },
    }
    try {
      const res = await checkFirecrawlTaskStatus(jobId) as any
      if (res.status === 'completed') {
        return {
          isError: false,
          data: {
            ...res,
            total: Math.min(res.total, Number.parseFloat(crawlOptions.limit as string)),
          },
        } satisfies CrawlFinishedResult
      }
      if (res.status === 'error' || !res.status) {
        // can't get the error message from the firecrawl api
        return {
          isError: true,
          errorMessage: res.message,
          data: {
            data: [],
          },
        } satisfies CrawlFinishedResult
      }
      res.data = res.data.map((item: any) => ({
        ...item,
        content: item.markdown,
      }))
      if (!isMountedRef.current)
        return cancelledResult
      // update the progress
      setCrawlResult({
        ...res,
        total: Math.min(res.total, Number.parseFloat(crawlOptions.limit as string)),
      })
      onCheckedCrawlResultChange(res.data || []) // default select the crawl result
      await sleep(2500)
      if (!isMountedRef.current)
        return cancelledResult
      return await waitForCrawlFinished(jobId)
    }
    catch (e: any) {
      if (!isMountedRef.current)
        return cancelledResult
      const errorBody = typeof e?.json === 'function' ? await e.json() : undefined
      return {
        isError: true,
        errorMessage: errorBody?.message,
        data: {
          data: [],
        },
      } satisfies CrawlFinishedResult
    }
  }, [crawlOptions.limit, onCheckedCrawlResultChange])
  const handleRun = useCallback(async (url: string) => {
    const { isValid, errorMsg } = checkValid(url)
    if (!isValid) {
      toast.error(errorMsg!)
      return
    }
    setStep(Step.running)
    try {
      const passToServerCrawlOptions: any = {
        ...crawlOptions,
      }
      if (crawlOptions.max_depth === '')
        delete passToServerCrawlOptions.max_depth
      const res = await createFirecrawlTask({
        url,
        options: passToServerCrawlOptions,
      }) as any
      if (!isMountedRef.current)
        return
      const jobId = res.job_id
      onJobIdChange(jobId)
      const { isCancelled, isError, data, errorMessage } = await waitForCrawlFinished(jobId)
      if (isCancelled || !isMountedRef.current)
        return
      if (isError) {
        setCrawlErrorMessage(errorMessage || t(`${I18N_PREFIX}.unknownError`, { ns: 'datasetCreation' }))
      }
      else {
        setCrawlResult(data as CrawlState)
        onCheckedCrawlResultChange(data.data || []) // default select the crawl result
        setCrawlErrorMessage('')
      }
    }
    catch (e) {
      if (!isMountedRef.current)
        return
      setCrawlErrorMessage(t(`${I18N_PREFIX}.unknownError`, { ns: 'datasetCreation' })!)
      console.log(e)
    }
    finally {
      if (isMountedRef.current)
        setStep(Step.finished)
    }
  }, [checkValid, crawlOptions, onJobIdChange, t, waitForCrawlFinished, onCheckedCrawlResultChange])
  return (
    <div>
      <Header onClickConfiguration={handleSetting} title={t(`${I18N_PREFIX}.firecrawlTitle`, { ns: 'datasetCreation' })} buttonText={t(`${I18N_PREFIX}.configureFirecrawl`, { ns: 'datasetCreation' })} docTitle={t(`${I18N_PREFIX}.firecrawlDoc`, { ns: 'datasetCreation' })} docLink="https://docs.firecrawl.dev/introduction" />
      <div className="mt-2 rounded-xl border border-components-panel-border bg-background-default-subtle p-4 pb-0">
        <UrlInput onRun={handleRun} isRunning={isRunning} />
        <OptionsWrap className="mt-4" controlFoldOptions={controlFoldOptions}>
          <Options className="mt-2" payload={crawlOptions} onChange={onCrawlOptionsChange} />
        </OptionsWrap>

        {!isInit && (
          <div className="relative left-[-16px] mt-3 w-[calc(100%+32px)] rounded-b-xl">
            {isRunning
              && (<Crawling className="mt-2" crawledNum={crawlResult?.current || 0} totalNum={crawlResult?.total || Number.parseFloat(crawlOptions.limit as string) || 0} />)}
            {showError && (<ErrorMessage className="rounded-b-xl" title={t(`${I18N_PREFIX}.exceptionErrorTitle`, { ns: 'datasetCreation' })} errorMsg={crawlErrorMessage} />)}
            {isCrawlFinished && !showError
              && (<CrawledResult className="mb-2" list={crawlResult?.data || []} checkedList={checkedCrawlResult} onSelectedChange={onCheckedCrawlResultChange} onPreview={onPreview} usedTime={Number.parseFloat(crawlResult?.time_consuming as string) || 0} />)}
          </div>
        )}
      </div>
    </div>
  )
}
export default React.memo(FireCrawl)
