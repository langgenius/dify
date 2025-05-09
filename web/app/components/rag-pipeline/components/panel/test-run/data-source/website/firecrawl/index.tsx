'use client'
import React, { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useModalContextSelector } from '@/context/modal-context'
import type { CrawlOptions, CrawlResultItem } from '@/models/datasets'
import { checkFirecrawlTaskStatus, createFirecrawlTask } from '@/service/datasets'
import { sleep } from '@/utils'
import Header from '@/app/components/datasets/create/website/base/header'
import Options from '../base/options'
import { useConfigurations, useSchema } from './hooks'
import Crawling from '../base/crawling'
import ErrorMessage from '../base/error-message'
import CrawledResult from '../base/crawled-result'

const I18N_PREFIX = 'datasetCreation.stepOne.website'

type FireCrawlProps = {
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

const FireCrawl = ({
  checkedCrawlResult,
  onCheckedCrawlResultChange,
  onJobIdChange,
  crawlOptions,
  onCrawlOptionsChange,
}: FireCrawlProps) => {
  const { t } = useTranslation()
  const [step, setStep] = useState<Step>(Step.init)
  const [controlFoldOptions, setControlFoldOptions] = useState<number>(0)
  const configurations = useConfigurations()
  const schema = useSchema()

  useEffect(() => {
    if (step !== Step.init)
      setControlFoldOptions(Date.now())
  }, [step])

  const setShowAccountSettingModal = useModalContextSelector(s => s.setShowAccountSettingModal)
  const handleSetting = useCallback(() => {
    setShowAccountSettingModal({
      payload: 'data-source',
    })
  }, [setShowAccountSettingModal])

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
      const res = await checkFirecrawlTaskStatus(jobId) as any
      if (res.status === 'completed') {
        return {
          isError: false,
          data: {
            ...res,
            total: Math.min(res.total, Number.parseFloat(crawlOptions.limit as string)),
          },
        }
      }
      if (res.status === 'error' || !res.status) {
        // can't get the error message from the firecrawl api
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

  const handleRun = useCallback(async (value: Record<string, any>) => {
    const { url, ...crawlOptions } = value
    onCrawlOptionsChange(crawlOptions as CrawlOptions)
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
      const jobId = res.job_id
      onJobIdChange(jobId)
      const { isError, data, errorMessage } = await waitForCrawlFinished(jobId)
      if (isError) {
        setCrawlErrorMessage(errorMessage || t(`${I18N_PREFIX}.unknownError`))
      }
      else {
        setCrawlResult(data)
        onCheckedCrawlResultChange(data.data || []) // default select the crawl result
        setCrawlErrorMessage('')
      }
    }
    catch (e) {
      setCrawlErrorMessage(t(`${I18N_PREFIX}.unknownError`)!)
      console.log(e)
    }
    finally {
      setStep(Step.finished)
    }
  }, [onCrawlOptionsChange, onJobIdChange, t, waitForCrawlFinished, onCheckedCrawlResultChange])

  return (
    <div>
      <Header
        isInPipeline
        onClickConfiguration={handleSetting}
        title={t(`${I18N_PREFIX}.firecrawlTitle`)}
        buttonText={t(`${I18N_PREFIX}.configureFirecrawl`)}
        docTitle={t(`${I18N_PREFIX}.firecrawlDoc`)}
        docLink={'https://docs.firecrawl.dev/introduction'}
      />
      <div className='mt-2 rounded-xl border border-components-panel-border bg-background-default-subtle'>
        <Options
          initialData={{
            ...crawlOptions,
            url: '',
          }}
          configurations={configurations}
          isRunning={isRunning}
          controlFoldOptions={controlFoldOptions}
          schema={schema}
          onSubmit={(value) => {
            handleRun(value)
            console.log('submit')
          }}
        />
      </div>
      {!isInit && (
        <div className='relative'>
          {isRunning && (
            <Crawling
              crawledNum={crawlResult?.current || 0}
              totalNum={crawlResult?.total || Number.parseFloat(crawlOptions.limit as string) || 0}
            />
          )}
          {showError && (
            <ErrorMessage
              className='mt-2'
              title={t(`${I18N_PREFIX}.exceptionErrorTitle`)}
              errorMsg={crawlErrorMessage}
            />
          )}
          {isCrawlFinished && !showError && (
            <CrawledResult
              className='mt-2'
              list={crawlResult?.data || []}
              checkedList={checkedCrawlResult}
              onSelectedChange={onCheckedCrawlResultChange}
              usedTime={Number.parseFloat(crawlResult?.time_consuming as string) || 0}
            />
          )}
        </div>
      )}
    </div>
  )
}
export default React.memo(FireCrawl)
