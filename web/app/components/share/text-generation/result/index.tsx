'use client'
import type { FC } from 'react'
import type { PromptConfig } from '@/models/debug'
import type { SiteInfo } from '@/models/share'
import type { AppSourceType } from '@/service/share'
import type { VisionFile, VisionSettings } from '@/types/app'
import { t } from 'i18next'
import { useCallback } from 'react'
import * as React from 'react'
import TextGenerationRes from '@/app/components/app/text-generate/item'
import Loading from '@/app/components/base/loading'
import { Button } from '@/app/components/base/ui/button'
import { toast } from '@/app/components/base/ui/toast'
import NoData from '@/app/components/share/text-generation/no-data'
import { useResultRunState } from './hooks/use-result-run-state'
import { useResultSender } from './hooks/use-result-sender'

type IResultProps = {
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
  inputs: Record<string, any>
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
  onRunControlChange?: (control: {
    onStop: () => Promise<void> | void
    isStopping: boolean
  } | null) => void
  hideInlineStopButton?: boolean
}
const Result: FC<IResultProps> = ({ isWorkflow, isCallBatchAPI, isPC, isMobile, appSourceType, appId, isError, isShowTextToSpeech, promptConfig, moreLikeThisEnabled, inputs, controlSend, controlRetry, controlStopResponding, onShowRes, handleSaveMessage, taskId, onCompleted, visionConfig, completionFiles, siteInfo, onRunStart, onRunControlChange, hideInlineStopButton = false }) => {
  const notify = useCallback(({ type, message }: { type: 'error' | 'info' | 'success' | 'warning', message: string }) => {
    toast(message, { type })
  }, [])
  const runState = useResultRunState({
    appId,
    appSourceType,
    controlStopResponding,
    isWorkflow,
    notify,
    onRunControlChange,
  })
  const { handleSend } = useResultSender({
    appId,
    appSourceType,
    completionFiles,
    controlRetry,
    controlSend,
    inputs,
    isCallBatchAPI,
    isPC,
    isWorkflow,
    notify,
    onCompleted,
    onRunStart,
    onShowRes,
    promptConfig,
    runState,
    t,
    taskId,
    visionConfig,
  })
  const isNoData = !runState.completionRes
  const renderTextGenerationRes = () => (
    <>
      {!hideInlineStopButton && runState.isResponding && runState.currentTaskId && (
        <div className={`mb-3 flex ${isPC ? 'justify-end' : 'justify-center'}`}>
          <Button variant="secondary" disabled={runState.isStopping} onClick={runState.handleStop}>
            {runState.isStopping
              ? <span aria-hidden className="mr-[5px] i-ri-loader-2-line h-3.5 w-3.5 animate-spin" />
              : <span aria-hidden className="mr-[5px] i-ri-stop-circle-fill h-3.5 w-3.5" />}
            <span className="text-xs font-normal">{t('operation.stopResponding', { ns: 'appDebug' })}</span>
          </Button>
        </div>
      )}
      <TextGenerationRes
        isWorkflow={isWorkflow}
        workflowProcessData={runState.workflowProcessData}
        isError={isError}
        onRetry={handleSend}
        content={runState.completionRes}
        messageId={runState.messageId}
        isInWebApp
        moreLikeThis={moreLikeThisEnabled}
        onFeedback={runState.handleFeedback}
        feedback={runState.feedback}
        onSave={handleSaveMessage}
        isMobile={isMobile}
        appSourceType={appSourceType}
        installedAppId={appId}
        // isLoading={isCallBatchAPI ? (!completionRes && isResponding) : false}
        isLoading={false}
        taskId={isCallBatchAPI ? ((taskId as number) < 10 ? `0${taskId}` : `${taskId}`) : undefined}
        controlClearMoreLikeThis={runState.controlClearMoreLikeThis}
        isShowTextToSpeech={isShowTextToSpeech}
        hideProcessDetail
        siteInfo={siteInfo}
      />
    </>
  )
  return (
    <>
      {!isCallBatchAPI && !isWorkflow && ((runState.isResponding && !runState.completionRes)
        ? (
            <div className="flex h-full w-full items-center justify-center">
              <Loading type="area" />
            </div>
          )
        : (
            <>
              {(isNoData)
                ? <NoData />
                : renderTextGenerationRes()}
            </>
          ))}
      {!isCallBatchAPI && isWorkflow && ((runState.isResponding && !runState.workflowProcessData)
        ? (
            <div className="flex h-full w-full items-center justify-center">
              <Loading type="area" />
            </div>
          )
        : !runState.workflowProcessData
            ? <NoData />
            : renderTextGenerationRes())}
      {isCallBatchAPI && renderTextGenerationRes()}
    </>
  )
}
export default React.memo(Result)
