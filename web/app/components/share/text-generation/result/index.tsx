'use client'
import type { FC } from 'react'
import React, { useEffect, useState } from 'react'
import { useBoolean } from 'ahooks'
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
  isBatch: boolean
  isPC: boolean
  isMobile: boolean
  isInstalledApp: boolean
  installedAppInfo?: InstalledApp
  promptConfig: PromptConfig | null
  moreLikeThisEnabled: boolean
  inputs: Record<string, any>
  query: string
  controlSend: number
  onShowRes: () => void
  handleSaveMessage: (messageId: string) => void
}

const Result: FC<IResultProps> = ({
  isBatch,
  isPC,
  isMobile,
  isInstalledApp,
  installedAppInfo,
  promptConfig,
  moreLikeThisEnabled,
  inputs,
  query,
  controlSend,
  onShowRes,
  handleSaveMessage,
}) => {
  const [isResponsing, { setTrue: setResponsingTrue, setFalse: setResponsingFalse }] = useBoolean(false)
  const [completionRes, setCompletionRes] = useState('')
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
      },
      onError() {
        setResponsingFalse()
      },
    }, isInstalledApp, installedAppInfo?.id)
  }

  useEffect(() => {
    if (controlSend)
      handleSend()
  }, [controlSend])

  return (
    <div className={cn((isBatch && !isNoData) ? 'h-52' : 'h-full')}>
      {(isResponsing && !completionRes)
        ? (
          <div className='flex h-full w-full justify-center items-center'>
            <Loading type='area' />
          </div>)
        : (
          <>
            {isNoData
              ? <NoData />
              : (
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
                />
              )
            }
          </>
        )}
    </div>
  )
}
export default React.memo(Result)
