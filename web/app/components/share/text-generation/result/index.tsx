'use client'
import type { FC } from 'react'
import type { InputValueTypes } from '../types'
import type { PromptConfig } from '@/models/debug'
import type { SiteInfo } from '@/models/share'
import type { AppSourceType } from '@/service/share'
import type { VisionFile, VisionSettings } from '@/types/app'
import { RiLoader2Line } from '@remixicon/react'
import { t } from 'i18next'
import * as React from 'react'
import TextGenerationRes from '@/app/components/app/text-generate/item'
import Button from '@/app/components/base/button'
import { StopCircle } from '@/app/components/base/icons/src/vender/solid/mediaAndDevices'
import Loading from '@/app/components/base/loading'
import NoData from '@/app/components/share/text-generation/no-data'
import { useTextGeneration } from './hooks/use-text-generation'

export type IResultProps = {
  isWorkflow: boolean
  isCallBatchAPI: boolean
  isPC: boolean
  isMobile: boolean
  appSourceType: AppSourceType
  appId?: string
  isError: boolean
  isShowTextToSpeech: boolean
  promptConfig: PromptConfig | null
  moreLikeThisEnabled: boolean
  inputs: Record<string, InputValueTypes>
  controlSend?: number
  controlRetry?: number
  controlStopResponding?: number
  onShowRes: () => void
  handleSaveMessage: (messageId: string) => void
  taskId?: number
  onCompleted: (completionRes: string, taskId?: number, success?: boolean) => void
  visionConfig: VisionSettings
  completionFiles: VisionFile[]
  siteInfo: SiteInfo | null
  onRunStart: () => void
  onRunControlChange?: (control: { onStop: () => Promise<void> | void, isStopping: boolean } | null) => void
  hideInlineStopButton?: boolean
}

const Result: FC<IResultProps> = (props) => {
  const {
    isWorkflow,
    isCallBatchAPI,
    isPC,
    isMobile,
    appSourceType,
    appId,
    isError,
    isShowTextToSpeech,
    moreLikeThisEnabled,
    handleSaveMessage,
    taskId,
    siteInfo,
    hideInlineStopButton = false,
  } = props

  const {
    isResponding,
    completionRes,
    workflowProcessData,
    messageId,
    feedback,
    isStopping,
    currentTaskId,
    controlClearMoreLikeThis,
    handleSend,
    handleStop,
    handleFeedback,
  } = useTextGeneration(props)

  // Determine content state using a unified check
  const hasData = isWorkflow ? !!workflowProcessData : !!completionRes
  const isLoadingState = !isCallBatchAPI && isResponding && !hasData
  const isEmptyState = !isCallBatchAPI && !hasData

  if (isLoadingState) {
    return (
      <div className="flex h-full w-full items-center justify-center">
        <Loading type="area" />
      </div>
    )
  }

  if (isEmptyState)
    return <NoData />

  return (
    <>
      {!hideInlineStopButton && isResponding && currentTaskId && (
        <div className={`mb-3 flex ${isPC ? 'justify-end' : 'justify-center'}`}>
          <Button variant="secondary" disabled={isStopping} onClick={handleStop}>
            {isStopping
              ? <RiLoader2Line className="mr-[5px] h-3.5 w-3.5 animate-spin" />
              : <StopCircle className="mr-[5px] h-3.5 w-3.5" />}
            <span className="text-xs font-normal">{t('operation.stopResponding', { ns: 'appDebug' })}</span>
          </Button>
        </div>
      )}
      <TextGenerationRes
        isWorkflow={isWorkflow}
        workflowProcessData={workflowProcessData}
        isError={isError}
        onRetry={handleSend}
        content={completionRes}
        messageId={messageId}
        isInWebApp
        moreLikeThis={moreLikeThisEnabled}
        onFeedback={handleFeedback}
        feedback={feedback}
        onSave={handleSaveMessage}
        isMobile={isMobile}
        appSourceType={appSourceType}
        installedAppId={appId}
        isLoading={isCallBatchAPI ? (!completionRes && isResponding) : false}
        taskId={isCallBatchAPI ? ((taskId as number) < 10 ? `0${taskId}` : `${taskId}`) : undefined}
        controlClearMoreLikeThis={controlClearMoreLikeThis}
        isShowTextToSpeech={isShowTextToSpeech}
        hideProcessDetail
        siteInfo={siteInfo}
      />
    </>
  )
}

export default React.memo(Result)
