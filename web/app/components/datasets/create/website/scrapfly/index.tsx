'use client'
import type { FC } from 'react'
import React, { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import UrlInput from '../base/url-input'
import OptionsWrap from '../base/options-wrap'
import CrawledResult from '../base/crawled-result'
import ErrorMessage from '../base/error-message'
import Header from './header'
import Options from './options'
import { useModalContext } from '@/context/modal-context'
import type { CrawlOptions, CrawlResultItem } from '@/models/datasets'
import Toast from '@/app/components/base/toast'
import { createScrapflyTask } from '@/service/datasets'

const ERROR_I18N_PREFIX = 'common.errorMsg'
const I18N_PREFIX = 'datasetCreation.stepOne.website'

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

const Scrapfly: FC<Props> = ({
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
      payload: 'data-source',
    })
  }, [setShowAccountSettingModal])

  const checkValid = useCallback((url: string) => {
    let errorMsg = ''
    if (!url) {
      errorMsg = t(`${ERROR_I18N_PREFIX}.fieldRequired`, {
        field: 'url',
      })
    }

    if (!errorMsg && !((url.startsWith('http://') || url.startsWith('https://'))))
      errorMsg = t(`${ERROR_I18N_PREFIX}.urlError`)

    return {
      isValid: !errorMsg,
      errorMsg,
    }
  }, [t])

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
      const res = await createScrapflyTask({
        url,
        options: crawlOptions,
      }) as any

      // Scrapfly returns immediate results
      if (res.data) {
        const endTime = Date.now()
        const data = {
          current: 1,
          total: 1,
          data: Array.isArray(res.data) ? res.data : [res.data],
          time_consuming: (endTime - startTime) / 1000,
        }
        setCrawlResult(data)
        onCheckedCrawlResultChange(data.data)
        setCrawlErrorMessage('')
        onJobIdChange('scrapfly_immediate')
      }
 else {
        setCrawlErrorMessage(t(`${I18N_PREFIX}.unknownError`)!)
      }
    }
    catch (e: any) {
      setCrawlErrorMessage(e.message || t(`${I18N_PREFIX}.unknownError`)!)
      console.error('Scrapfly error:', e)
    }
    finally {
      setStep(Step.finished)
    }
  }, [checkValid, crawlOptions, onCheckedCrawlResultChange, onJobIdChange, t])

  return (
    <div>
      <Header onSetting={handleSetting} />
      <div className='mt-2 rounded-xl border border-components-panel-border bg-background-default-subtle p-4 pb-0'>
        <UrlInput onRun={handleRun} isRunning={isRunning} />
        <OptionsWrap
          className='mt-4'
          controlFoldOptions={controlFoldOptions}
        >
          <Options className='mt-2' payload={crawlOptions} onChange={onCrawlOptionsChange} />
        </OptionsWrap>

        {!isInit && (
          <div className='relative left-[-16px] mt-3 w-[calc(100%_+_32px)] rounded-b-xl'>
            {showError && (
              <ErrorMessage className='rounded-b-xl' title={t(`${I18N_PREFIX}.exceptionErrorTitle`)} errorMsg={crawlErrorMessage} />
            )}
            {isCrawlFinished && !showError
              && <CrawledResult
                className='mb-2'
                list={crawlResult?.data || []}
                checkedList={checkedCrawlResult}
                onSelectedChange={onCheckedCrawlResultChange}
                onPreview={onPreview}
                usedTime={Number.parseFloat(crawlResult?.time_consuming as string) || 0}
              />
            }
          </div>
        )}
      </div>
    </div>
  )
}
export default React.memo(Scrapfly)
