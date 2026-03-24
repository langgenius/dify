'use client'
import type { FC } from 'react'
import type { InputValueTypes, TextGenerationRunControl } from './types'
import type { InstalledApp } from '@/models/explore'
import type { VisionFile } from '@/types/app'
import { useBoolean } from 'ahooks'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Loading from '@/app/components/base/loading'
import Toast from '@/app/components/base/toast'
import useBreakpoints, { MediaType } from '@/hooks/use-breakpoints'
import { useSearchParams } from '@/next/navigation'
import { cn } from '@/utils/classnames'
import { useTextGenerationAppState } from './hooks/use-text-generation-app-state'
import { useTextGenerationBatch } from './hooks/use-text-generation-batch'
import TextGenerationResultPanel from './text-generation-result-panel'
import TextGenerationSidebar from './text-generation-sidebar'

export type IMainProps = {
  isInstalledApp?: boolean
  installedAppInfo?: InstalledApp
  isWorkflow?: boolean
}

const TextGeneration: FC<IMainProps> = ({
  isInstalledApp = false,
  isWorkflow = false,
}) => {
  const { notify } = Toast
  const { t } = useTranslation()
  const media = useBreakpoints()
  const isPC = media === MediaType.pc

  const searchParams = useSearchParams()
  const mode = searchParams.get('mode') || 'create'
  const [currentTab, setCurrentTab] = useState<string>(['create', 'batch'].includes(mode) ? mode : 'create')
  const [inputs, setInputs] = useState<Record<string, InputValueTypes>>({})
  const inputsRef = useRef(inputs)
  const [completionFiles, setCompletionFiles] = useState<VisionFile[]>([])
  const [runControl, setRunControl] = useState<TextGenerationRunControl | null>(null)
  const [controlSend, setControlSend] = useState(0)
  const [controlStopResponding, setControlStopResponding] = useState(0)
  const [resultExisted, setResultExisted] = useState(false)
  const [isShowResultPanel, { setTrue: showResultPanelState, setFalse: hideResultPanel }] = useBoolean(false)

  const updateInputs = useCallback((newInputs: Record<string, InputValueTypes>) => {
    setInputs(newInputs)
    inputsRef.current = newInputs
  }, [])

  const {
    accessMode,
    appId,
    appSourceType,
    customConfig,
    handleRemoveSavedMessage,
    handleSaveMessage,
    moreLikeThisConfig,
    promptConfig,
    savedMessages,
    siteInfo,
    systemFeatures,
    textToSpeechConfig,
    visionConfig,
  } = useTextGenerationAppState({
    isInstalledApp,
    isWorkflow,
  })

  const {
    allFailedTaskList,
    allSuccessTaskList,
    allTaskList,
    allTasksRun,
    controlRetry,
    exportRes,
    handleCompleted,
    handleRetryAllFailedTask,
    handleRunBatch: runBatchExecution,
    isCallBatchAPI,
    noPendingTask,
    resetBatchExecution,
    setIsCallBatchAPI,
    showTaskList,
  } = useTextGenerationBatch({
    promptConfig,
    notify,
    t,
  })

  useEffect(() => {
    if (isCallBatchAPI)
      setRunControl(null)
  }, [isCallBatchAPI])

  const showResultPanel = useCallback(() => {
    setTimeout(() => {
      showResultPanelState()
    }, 0)
  }, [showResultPanelState])
  const handleRunStart = useCallback(() => {
    setResultExisted(true)
  }, [])

  const handleRunOnce = useCallback(() => {
    setIsCallBatchAPI(false)
    setControlSend(Date.now())
    resetBatchExecution()
    showResultPanel()
  }, [resetBatchExecution, setIsCallBatchAPI, showResultPanel])

  const handleRunBatch = useCallback((data: string[][]) => {
    runBatchExecution(data, {
      onStart: () => {
        setControlSend(Date.now())
        setControlStopResponding(Date.now())
        showResultPanel()
      },
    })
  }, [runBatchExecution, showResultPanel])

  if (!appId || !siteInfo || !promptConfig) {
    return (
      <div className="flex h-screen items-center">
        <Loading type="app" />
      </div>
    )
  }

  return (
    <div
      className={cn(
        'bg-background-default-burn',
        isPC ? 'flex' : 'flex-col',
        isInstalledApp ? 'h-full rounded-2xl shadow-md' : 'h-screen',
      )}
    >
      <TextGenerationSidebar
        accessMode={accessMode}
        allTasksRun={allTasksRun}
        currentTab={currentTab}
        customConfig={customConfig}
        inputs={inputs}
        inputsRef={inputsRef}
        isInstalledApp={isInstalledApp}
        isPC={isPC}
        isWorkflow={isWorkflow}
        onBatchSend={handleRunBatch}
        onInputsChange={updateInputs}
        onRemoveSavedMessage={handleRemoveSavedMessage}
        onRunOnceSend={handleRunOnce}
        onTabChange={setCurrentTab}
        onVisionFilesChange={setCompletionFiles}
        promptConfig={promptConfig}
        resultExisted={resultExisted}
        runControl={runControl}
        savedMessages={savedMessages}
        siteInfo={siteInfo}
        systemFeatures={systemFeatures}
        textToSpeechConfig={textToSpeechConfig}
        visionConfig={visionConfig}
      />
      <TextGenerationResultPanel
        allFailedTaskList={allFailedTaskList}
        allSuccessTaskList={allSuccessTaskList}
        allTaskList={allTaskList}
        appId={appId}
        appSourceType={appSourceType}
        completionFiles={completionFiles}
        controlRetry={controlRetry}
        controlSend={controlSend}
        controlStopResponding={controlStopResponding}
        exportRes={exportRes}
        handleCompleted={handleCompleted}
        handleRetryAllFailedTask={handleRetryAllFailedTask}
        handleSaveMessage={handleSaveMessage}
        inputs={inputs}
        isCallBatchAPI={isCallBatchAPI}
        isPC={isPC}
        isShowResultPanel={isShowResultPanel}
        isWorkflow={isWorkflow}
        moreLikeThisEnabled={!!moreLikeThisConfig?.enabled}
        noPendingTask={noPendingTask}
        onHideResultPanel={hideResultPanel}
        onRunControlChange={setRunControl}
        onRunStart={handleRunStart}
        onShowResultPanel={showResultPanel}
        promptConfig={promptConfig}
        resultExisted={resultExisted}
        showTaskList={showTaskList}
        siteInfo={siteInfo}
        textToSpeechEnabled={!!textToSpeechConfig?.enabled}
        visionConfig={visionConfig}
      />
    </div>
  )
}

export default TextGeneration
