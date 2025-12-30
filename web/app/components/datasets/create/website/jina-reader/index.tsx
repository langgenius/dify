'use client'
import type { FC } from 'react'
import type { CrawlOptions, CrawlResultItem } from '@/models/datasets'
import * as React from 'react'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Toast from '@/app/components/base/toast'
import { ACCOUNT_SETTING_TAB } from '@/app/components/header/account-setting/constants'
import { useModalContext } from '@/context/modal-context'
import { checkJinaReaderTaskStatus, createJinaReaderTask } from '@/service/datasets'
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

const JinaReader: FC<Props> = ({
  onPreview,
  checkedCrawlResult,
  onCheckedCrawlResultChange,
  onJobIdChange,
  crawlOptions,
  onCrawlOptionsChange,
}) => {
  const { t } = useTranslation()
  const [step, setStep] = useState<Step>(Step.init)
  const [controlFoldOptions, setControlFoldOptions] = useState<number>(0)
  useEffect(() => {
    if (step !== Step.init)
      setControlFoldOptions(Date.now())
  }, [step])
  const { setShowAccountSettingModal } = useModalContext()
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
  const [crawlResult, setCrawlResult] = useState<{
    current: number
    total: number
    data: CrawlResultItem[]
    time_consuming: number | string
  } | undefined>(undefined)
  const [crawlErrorMessage, setCrawlErrorMessage] = useState('')
  const showError = isCrawlFinished && crawlErrorMessage

  const waitForCrawlFinished = useCallback(async (jobId: string) => {
    try {
      const res = await checkJinaReaderTaskStatus(jobId) as any
      if (res.status === 'completed') {
        return {
          isError: false,
          data: {
            ...res,
            total: Math.min(res.total, Number.parseFloat(crawlOptions.limit as string)),
          },
        }
      }
      if (res.status === 'failed' || !res.status) {
        return {
          isError: true,
          errorMessage: res.message,
          data: {
            data: [],
          },
        }
      }
      // update the progress
      setCrawlResult({
        ...res,
        total: Math.min(res.total, Number.parseFloat(crawlOptions.limit as string)),
      })
      onCheckedCrawlResultChange(res.data || []) // default select the crawl result
      await sleep(2500)
      return await waitForCrawlFinished(jobId)
    }
    catch (e: any) {
      const errorBody = await e.json()
      return {
        isError: true,
        errorMessage: errorBody.message,
        data: {
          data: [],
        },
      }
    }
  }, [crawlOptions.limit, onCheckedCrawlResultChange])

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
    try {
      const startTime = Date.now()
      const res = await createJinaReaderTask({
        url,
        options: crawlOptions,
      }) as any

      if (res.data) {
        const { title, content, description, url } = res.data
        const data = {
          current: 1,
          total: 1,
          data: [{
            title,
            markdown: content,
            description,
            source_url: url,
          }],
          time_consuming: (Date.now() - startTime) / 1000,
        }
        setCrawlResult(data)
        onCheckedCrawlResultChange(data.data || [])
        setCrawlErrorMessage('')
      }
      else if (res.job_id) {
        const jobId = res.job_id
        onJobIdChange(jobId)
        const { isError, data, errorMessage } = await waitForCrawlFinished(jobId)
        if (isError) {
          setCrawlErrorMessage(errorMessage || t(`${I18N_PREFIX}.unknownError`, { ns: 'datasetCreation' }))
        }
        else {
          setCrawlResult(data)
          onCheckedCrawlResultChange(data.data || []) // default select the crawl result
          setCrawlErrorMessage('')
        }
      }
    }
    catch (e) {
      setCrawlErrorMessage(t(`${I18N_PREFIX}.unknownError`, { ns: 'datasetCreation' })!)
      console.log(e)
    }
    finally {
      setStep(Step.finished)
    }
  }, [checkValid, crawlOptions, onCheckedCrawlResultChange, onJobIdChange, t, waitForCrawlFinished])

  return (
    <div>
      <Header
        onClickConfiguration={handleSetting}
        title={t(`${I18N_PREFIX}.jinaReaderTitle`, { ns: 'datasetCreation' })}
        buttonText={t(`${I18N_PREFIX}.configureJinaReader`, { ns: 'datasetCreation' })}
        docTitle={t(`${I18N_PREFIX}.jinaReaderDoc`, { ns: 'datasetCreation' })}
        docLink="https://jina.ai/reader"
      />
      <div className="mt-2 rounded-xl border border-components-panel-border bg-background-default-subtle p-4 pb-0">
        <UrlInput onRun={handleRun} isRunning={isRunning} />
        <OptionsWrap
          className="mt-4"
          controlFoldOptions={controlFoldOptions}
        >
          <Options className="mt-2" payload={crawlOptions} onChange={onCrawlOptionsChange} />
        </OptionsWrap>

        {!isInit && (
          <div className="relative left-[-16px] mt-3 w-[calc(100%_+_32px)] rounded-b-xl">
            {isRunning
              && (
                <Crawling
                  className="mt-2"
                  crawledNum={crawlResult?.current || 0}
                  totalNum={crawlResult?.total || Number.parseFloat(crawlOptions.limit as string) || 0}
                />
              )}
            {showError && (
              <ErrorMessage className="rounded-b-xl" title={t(`${I18N_PREFIX}.exceptionErrorTitle`, { ns: 'datasetCreation' })} errorMsg={crawlErrorMessage} />
            )}
            {isCrawlFinished && !showError
              && (
                <CrawledResult
                  className="mb-2"
                  list={crawlResult?.data || []}
                  checkedList={checkedCrawlResult}
                  onSelectedChange={onCheckedCrawlResultChange}
                  onPreview={onPreview}
                  usedTime={Number.parseFloat(crawlResult?.time_consuming as string) || 0}
                />
              )}
          </div>
        )}
      </div>
    </div>
  )
}
export default React.memo(JinaReader)
