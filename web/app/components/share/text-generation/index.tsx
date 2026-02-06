'use client'
import type { FC } from 'react'
import type { InputValueTypes, Task } from './types'
import type { InstalledApp } from '@/models/explore'
import type { VisionFile } from '@/types/app'
import { useBoolean } from 'ahooks'
import { useSearchParams } from 'next/navigation'
import { useCallback, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import SavedItems from '@/app/components/app/text-generate/saved-items'
import Loading from '@/app/components/base/loading'
import Res from '@/app/components/share/text-generation/result'
import RunOnce from '@/app/components/share/text-generation/run-once'
import { useAppFavicon } from '@/hooks/use-app-favicon'
import useBreakpoints, { MediaType } from '@/hooks/use-breakpoints'
import useDocumentTitle from '@/hooks/use-document-title'
import { AppSourceType } from '@/service/share'
import { cn } from '@/utils/classnames'
import HeaderSection from './components/header-section'
import PoweredBy from './components/powered-by'
import ResultPanel from './components/result-panel'
import { useAppConfig } from './hooks/use-app-config'
import { useBatchTasks } from './hooks/use-batch-tasks'
import { useRemoveMessageMutation, useSavedMessages, useSaveMessageMutation } from './hooks/use-saved-messages'
import RunBatch from './run-batch'
import { TaskStatus } from './types'

export type IMainProps = {
  isInstalledApp?: boolean
  installedAppInfo?: InstalledApp
  isWorkflow?: boolean
}

const TextGeneration: FC<IMainProps> = ({
  isInstalledApp = false,
  isWorkflow = false,
}) => {
  const { t } = useTranslation()
  const media = useBreakpoints()
  const isPC = media === MediaType.pc

  const searchParams = useSearchParams()
  const mode = searchParams.get('mode') || 'create'
  const [currentTab, setCurrentTab] = useState<string>(['create', 'batch'].includes(mode) ? mode : 'create')

  // App configuration derived from store
  const {
    appId,
    siteInfo,
    customConfig,
    promptConfig,
    moreLikeThisConfig,
    textToSpeechConfig,
    visionConfig,
    accessMode,
    isReady,
  } = useAppConfig()

  const appSourceType = isInstalledApp ? AppSourceType.installedApp : AppSourceType.webApp

  // Saved messages (React Query)
  const { data: savedMessages = [] } = useSavedMessages(appSourceType, appId, !isWorkflow)
  const saveMutation = useSaveMessageMutation(appSourceType, appId)
  const removeMutation = useRemoveMessageMutation(appSourceType, appId)

  // Batch task management
  const {
    isCallBatchAPI,
    controlRetry,
    allTaskList,
    showTaskList,
    noPendingTask,
    allSuccessTaskList,
    allFailedTaskList,
    allTasksRun,
    exportRes,
    clearBatchState,
    startBatchRun,
    handleCompleted,
    handleRetryAllFailedTask,
  } = useBatchTasks(promptConfig)

  // Input state with ref for accessing latest value in async callbacks
  const [inputs, doSetInputs] = useState<Record<string, InputValueTypes>>({})
  const inputsRef = useRef(inputs)
  const setInputs = useCallback((newInputs: Record<string, InputValueTypes>) => {
    doSetInputs(newInputs)
    inputsRef.current = newInputs
  }, [])

  // Send control signals
  const [controlSend, setControlSend] = useState(0)
  const [controlStopResponding, setControlStopResponding] = useState(0)
  const [completionFiles, setCompletionFiles] = useState<VisionFile[]>([])
  const [runControl, setRunControl] = useState<{ onStop: () => Promise<void> | void, isStopping: boolean } | null>(null)

  // Result panel visibility
  const [isShowResultPanel, { setTrue: doShowResultPanel, setFalse: hideResultPanel }] = useBoolean(false)
  const showResultPanel = useCallback(() => {
    // Delay to avoid useClickAway closing the panel immediately
    setTimeout(doShowResultPanel, 0)
  }, [doShowResultPanel])
  const [resultExisted, setResultExisted] = useState(false)

  const handleSend = useCallback(() => {
    clearBatchState()
    setControlSend(Date.now())
    showResultPanel()
  }, [clearBatchState, showResultPanel])

  const handleRunBatch = useCallback((data: string[][]) => {
    if (!startBatchRun(data))
      return
    setRunControl(null)
    setControlSend(Date.now())
    setControlStopResponding(Date.now())
    showResultPanel()
  }, [startBatchRun, showResultPanel])

  useDocumentTitle(siteInfo?.title || t('generation.title', { ns: 'share' }))
  useAppFavicon({
    enable: !isInstalledApp,
    icon_type: siteInfo?.icon_type,
    icon: siteInfo?.icon,
    icon_background: siteInfo?.icon_background,
    icon_url: siteInfo?.icon_url,
  })

  const renderRes = (task?: Task) => (
    <Res
      key={task?.id}
      isWorkflow={isWorkflow}
      isCallBatchAPI={isCallBatchAPI}
      isPC={isPC}
      isMobile={!isPC}
      appSourceType={appSourceType}
      appId={appId}
      isError={task?.status === TaskStatus.failed}
      promptConfig={promptConfig}
      moreLikeThisEnabled={!!moreLikeThisConfig?.enabled}
      inputs={isCallBatchAPI ? (task as Task).params.inputs : inputs}
      controlSend={controlSend}
      controlRetry={task?.status === TaskStatus.failed ? controlRetry : 0}
      controlStopResponding={controlStopResponding}
      onShowRes={showResultPanel}
      handleSaveMessage={id => saveMutation.mutate(id)}
      taskId={task?.id}
      onCompleted={handleCompleted}
      visionConfig={visionConfig}
      completionFiles={completionFiles}
      isShowTextToSpeech={!!textToSpeechConfig?.enabled}
      siteInfo={siteInfo}
      onRunStart={() => setResultExisted(true)}
      onRunControlChange={!isCallBatchAPI ? setRunControl : undefined}
      hideInlineStopButton={!isCallBatchAPI}
    />
  )

  if (!isReady) {
    return (
      <div className="flex h-screen items-center">
        <Loading type="app" />
      </div>
    )
  }

  return (
    <div className={cn(
      'bg-background-default-burn',
      isPC && 'flex',
      !isPC && 'flex-col',
      isInstalledApp ? 'h-full rounded-2xl shadow-md' : 'h-screen',
    )}
    >
      {/* Left panel */}
      <div className={cn(
        'relative flex h-full shrink-0 flex-col',
        isPC ? 'w-[600px] max-w-[50%]' : resultExisted ? 'h-[calc(100%_-_64px)]' : '',
        isInstalledApp && 'rounded-l-2xl',
      )}
      >
        <HeaderSection
          isPC={isPC}
          isInstalledApp={isInstalledApp}
          isWorkflow={isWorkflow}
          siteInfo={siteInfo!}
          accessMode={accessMode}
          savedMessages={savedMessages}
          currentTab={currentTab}
          onTabChange={setCurrentTab}
        />
        {/* Form content */}
        <div className={cn(
          'h-0 grow overflow-y-auto bg-components-panel-bg',
          isPC ? 'px-8' : 'px-4',
          !isPC && resultExisted && customConfig?.remove_webapp_brand && 'rounded-b-2xl border-b-[0.5px] border-divider-regular',
        )}
        >
          <div className={cn(currentTab === 'create' ? 'block' : 'hidden')}>
            <RunOnce
              siteInfo={siteInfo!}
              inputs={inputs}
              inputsRef={inputsRef}
              onInputsChange={setInputs}
              promptConfig={promptConfig!}
              onSend={handleSend}
              visionConfig={visionConfig}
              onVisionFilesChange={setCompletionFiles}
              runControl={runControl}
            />
          </div>
          <div className={cn(currentTab === 'batch' ? 'block' : 'hidden')}>
            <RunBatch
              vars={promptConfig!.prompt_variables}
              onSend={handleRunBatch}
              isAllFinished={allTasksRun}
            />
          </div>
          {currentTab === 'saved' && (
            <SavedItems
              className={cn(isPC ? 'mt-6' : 'mt-4')}
              isShowTextToSpeech={textToSpeechConfig?.enabled}
              list={savedMessages}
              onRemove={id => removeMutation.mutate(id)}
              onStartCreateContent={() => setCurrentTab('create')}
            />
          )}
        </div>
        <PoweredBy isPC={isPC} resultExisted={resultExisted} customConfig={customConfig} />
      </div>

      {/* Right panel - Results */}
      <div className={cn(
        isPC
          ? 'h-full w-0 grow'
          : isShowResultPanel
            ? 'fixed inset-0 z-50 bg-background-overlay backdrop-blur-sm'
            : resultExisted
              ? 'relative h-16 shrink-0 overflow-hidden bg-background-default-burn pt-2.5'
              : '',
      )}
      >
        {!isPC && (
          <div
            className={cn(
              isShowResultPanel
                ? 'flex items-center justify-center p-2 pt-6'
                : 'absolute left-0 top-0 z-10 flex w-full items-center justify-center px-2 pb-[57px] pt-[3px]',
            )}
            onClick={() => isShowResultPanel ? hideResultPanel() : showResultPanel()}
          >
            <div className="h-1 w-8 cursor-grab rounded bg-divider-solid" />
          </div>
        )}
        <ResultPanel
          isPC={isPC}
          isShowResultPanel={isShowResultPanel}
          isCallBatchAPI={isCallBatchAPI}
          totalTasks={allTaskList.length}
          successCount={allSuccessTaskList.length}
          failedCount={allFailedTaskList.length}
          noPendingTask={noPendingTask}
          exportRes={exportRes}
          onRetryFailed={handleRetryAllFailedTask}
        >
          {!isCallBatchAPI
            ? renderRes()
            : showTaskList.map(task => renderRes(task))}
        </ResultPanel>
      </div>
    </div>
  )
}

export default TextGeneration
