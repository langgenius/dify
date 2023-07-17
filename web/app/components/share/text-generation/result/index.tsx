'use client'
import type { FC } from 'react'
import React, { useEffect, useState } from 'react'
import { useBoolean, useGetState } from 'ahooks'
import { t } from 'i18next'
import cn from 'classnames'
import TextGenerationRes from '@/app/components/app/text-generate/item'
import NoData from '@/app/components/share/text-generation/no-data'
import Toast from '@/app/components/base/toast'
import { sendCompletionMessage, updateFeedback } from '@/service/share'
import type { Feedbacktype } from '@/app/components/app/chat'
import Loading from '@/app/components/base/loading'
import type { PromptConfig } from '@/models/debug'
import type { InstalledApp } from '@/models/explore'
export type IResultProps = {
  isCallBatchAPI: boolean
  isPC: boolean
  isMobile: boolean
  isInstalledApp: boolean
  installedAppInfo?: InstalledApp
  promptConfig: PromptConfig | null
  moreLikeThisEnabled: boolean
  inputs: Record<string, any>
  query: string
  controlSend?: number
  controlStopResponding?: number
  onShowRes: () => void
  handleSaveMessage: (messageId: string) => void
  taskId?: number
  onCompleted: (completionRes: string, taskId?: number, success?: boolean) => void
}

const Result: FC<IResultProps> = ({
  isCallBatchAPI,
  isPC,
  isMobile,
  isInstalledApp,
  installedAppInfo,
  promptConfig,
  moreLikeThisEnabled,
  inputs,
  query,
  controlSend,
  controlStopResponding,
  onShowRes,
  handleSaveMessage,
  taskId,
  onCompleted,
}) => {
  const [isResponsing, { setTrue: setResponsingTrue, setFalse: setResponsingFalse }] = useBoolean(false)
  useEffect(() => {
    if (controlStopResponding)
      setResponsingFalse()
  }, [controlStopResponding])

  const [completionRes, setCompletionRes, getCompletionRes] = useGetState('')
  const { notify } = Toast
  const isNoData = !completionRes

  const [messageId, setMessageId] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<Feedbacktype>({
    rating: null,
  })

  const handleFeedback = async (feedback: Feedbacktype) => {
    await updateFeedback({ url: `/messages/${messageId}/feedbacks`, body: { rating: feedback.rating } }, isInstalledApp, installedAppInfo?.id)
    setFeedback(feedback)
  }

  const logError = (message: string) => {
    notify({ type: 'error', message })
  }

  const checkCanSend = () => {
    // batch will check outer
    if (isCallBatchAPI)
      return true

    const prompt_variables = promptConfig?.prompt_variables
    if (!prompt_variables || prompt_variables?.length === 0)
      return true

    let hasEmptyInput = false
    const requiredVars = prompt_variables?.filter(({ key, name, required }) => {
      const res = (!key || !key.trim()) || (!name || !name.trim()) || (required || required === undefined || required === null)
      return res
    }) || [] // compatible with old version
    requiredVars.forEach(({ key }) => {
      if (hasEmptyInput)
        return

      if (!inputs[key])
        hasEmptyInput = true
    })

    if (hasEmptyInput) {
      logError(t('appDebug.errorMessage.valueOfVarRequired'))
      return false
    }
    return !hasEmptyInput
  }

  const handleSend = async () => {
    if (isResponsing) {
      notify({ type: 'info', message: t('appDebug.errorMessage.waitForResponse') })
      return false
    }

    if (!checkCanSend())
      return

    if (!query) {
      logError(t('appDebug.errorMessage.queryRequired'))
      return false
    }

    const data = {
      inputs,
      query,
    }

    setMessageId(null)
    setFeedback({
      rating: null,
    })
    setCompletionRes('')

    const res: string[] = []
    let tempMessageId = ''

    if (!isPC)
      onShowRes()

    setResponsingTrue()
    sendCompletionMessage(data, {
      onData: (data: string, _isFirstMessage: boolean, { messageId }: any) => {
        tempMessageId = messageId
        res.push(data)
        setCompletionRes(res.join(''))
      },
      onCompleted: () => {
        setResponsingFalse()
        setMessageId(tempMessageId)
        onCompleted(getCompletionRes(), taskId, true)
      },
      onError() {
        setResponsingFalse()
        onCompleted(getCompletionRes(), taskId, false)
      },
    }, isInstalledApp, installedAppInfo?.id)
  }

  const [controlClearMoreLikeThis, setControlClearMoreLikeThis] = useState(0)
  useEffect(() => {
    if (controlSend) {
      handleSend()
      setControlClearMoreLikeThis(Date.now())
    }
  }, [controlSend])

  const renderTextGenerationRes = () => (
    <TextGenerationRes
      className='mt-3'
      content={completionRes}
      messageId={messageId}
      isInWebApp
      moreLikeThis={moreLikeThisEnabled}
      onFeedback={handleFeedback}
      feedback={feedback}
      onSave={handleSaveMessage}
      isMobile={isMobile}
      isInstalledApp={isInstalledApp}
      installedAppId={installedAppInfo?.id}
      isLoading={isCallBatchAPI ? (!completionRes && isResponsing) : false}
      taskId={isCallBatchAPI ? ((taskId as number) < 10 ? `0${taskId}` : `${taskId}`) : undefined}
      controlClearMoreLikeThis={controlClearMoreLikeThis}
    />
  )

  return (
    <div className={cn(isNoData && !isCallBatchAPI && 'h-full')}>
      {!isCallBatchAPI && (
        (isResponsing && !completionRes)
          ? (
            <div className='flex h-full w-full justify-center items-center'>
              <Loading type='area' />
            </div>)
          : (
            <>
              {isNoData
                ? <NoData />
                : renderTextGenerationRes()
              }
            </>
          )
      )}
      {isCallBatchAPI && (
        <div className='mt-2'>
          {renderTextGenerationRes()}
        </div>
      )}
    </div>
  )
}
export default React.memo(Result)
