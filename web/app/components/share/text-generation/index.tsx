'use client'
import type { ToastType } from '@langgenius/dify-ui/toast'
import type { FC } from 'react'
import type { InputValueTypes, TextGenerationRunControl } from './types'
import type { WorkflowRunSnapshot } from './workflow-run-configuration'
import type { VisionFile } from '@/types/app'
import { cn } from '@langgenius/dify-ui/cn'
import { useBoolean } from 'ahooks'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LoadingPlaceholder } from '@/app/components/base/loading-placeholder'
import { WebAppConnectionsProvider } from '@/app/components/share/connections/connection-provider'
import { useOptionalWebAppConnections } from '@/app/components/share/connections/use-connections'
import { toast } from '@/app/notifications'
import useBreakpoints, { MediaType } from '@/hooks/use-breakpoints'
import { useSearchParams } from '@/next/navigation'
import { resolveWebAppAddress } from '@/service/webapp-address'
import { useTextGenerationAppState } from './hooks/use-text-generation-app-state'
import { useTextGenerationBatch } from './hooks/use-text-generation-batch'
import TextGenerationResultPanel from './text-generation-result-panel'
import TextGenerationSidebar from './text-generation-sidebar'
import { captureWorkflowRunConfiguration } from './workflow-run-configuration'

type IMainProps = {
  isInstalledApp?: boolean
  isWorkflow?: boolean
}
const TextGenerationContent: FC<IMainProps> = ({ isInstalledApp = false, isWorkflow = false }) => {
  const { t } = useTranslation(['share', 'appDebug', 'common', 'workflow'])
  const connections = useOptionalWebAppConnections()
  const [setupComplete, setSetupComplete] = useState(false)
  const [runSnapshot, setRunSnapshot] = useState<WorkflowRunSnapshot>()
  const media = useBreakpoints()
  const isPC = media === MediaType.pc
  const searchParams = useSearchParams()
  const mode = searchParams.get('mode') || 'create'
  const [currentTab, setCurrentTab] = useState<string>(
    ['create', 'batch'].includes(mode) ? mode : 'create',
  )
  const [inputs, setInputs] = useState<Record<string, InputValueTypes>>({})
  const inputsRef = useRef(inputs)
  const [completionFiles, setCompletionFiles] = useState<VisionFile[]>([])
  const [runControl, setRunControl] = useState<TextGenerationRunControl | null>(null)
  const [controlSend, setControlSend] = useState(0)
  const [controlStopResponding, setControlStopResponding] = useState(0)
  const [resultExisted, setResultExisted] = useState(false)
  const [isShowResultPanel, { setTrue: showResultPanelState, setFalse: hideResultPanel }] =
    useBoolean(false)
  const notify = useCallback(({ type, message }: { type: ToastType; message: string }) => {
    toast(message, { type })
  }, [])
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
    handleRetryAllFailedTask: retryAllFailedTasks,
    handleTaskStart,
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
    if (isCallBatchAPI) setRunControl(null)
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
    if (runControl || (isCallBatchAPI && !allTasksRun)) return
    const snapshot = captureWorkflowRunConfiguration(connections)
    if (snapshot === false) return
    setRunSnapshot(snapshot)
    setIsCallBatchAPI(false)
    setControlSend(Date.now())
    resetBatchExecution()
    showResultPanel()
  }, [
    allTasksRun,
    connections,
    isCallBatchAPI,
    resetBatchExecution,
    runControl,
    setIsCallBatchAPI,
    showResultPanel,
  ])
  const handleRunBatch = useCallback(
    (data: string[][]) => {
      if (runControl) return
      const snapshot = captureWorkflowRunConfiguration(connections)
      if (snapshot === false) return
      runBatchExecution(data, {
        onStart: () => {
          setRunSnapshot(snapshot)
          setControlSend(Date.now())
          setControlStopResponding(Date.now())
          showResultPanel()
        },
      })
    },
    [connections, runBatchExecution, runControl, showResultPanel],
  )
  const handleRetryAllFailedTask = () => {
    if (!allTasksRun || runControl) return
    const snapshot = captureWorkflowRunConfiguration(connections)
    if (snapshot === false) return
    setRunSnapshot(snapshot)
    retryAllFailedTasks()
  }
  if (!appId || !siteInfo || !promptConfig) {
    return (
      <div className="flex h-screen items-center">
        <LoadingPlaceholder className="h-full" />
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
        connectionsReady={connections?.canRun ?? true}
        isConfiguringConnections={Boolean(
          connections && connections.status !== 'inactive' && !setupComplete,
        )}
        onStartUsingApp={() => setSetupComplete(true)}
        isResponding={Boolean(runControl) || (isCallBatchAPI && !allTasksRun)}
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
        runSnapshot={runSnapshot}
        onTaskStart={handleTaskStart}
        connectionsReady={(connections?.canRun ?? true) && allTasksRun && !runControl}
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
const TextGeneration: FC<IMainProps> = (props) => {
  const address = resolveWebAppAddress()
  if (!props.isInstalledApp && props.isWorkflow && address?.kind === 'default') {
    return (
      <WebAppConnectionsProvider address={address}>
        <TextGenerationContent {...props} />
      </WebAppConnectionsProvider>
    )
  }
  return <TextGenerationContent {...props} />
}

export default TextGeneration
