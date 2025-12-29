'use client'
import type { FC } from 'react'
import type { Task } from './hooks/use-batch-tasks'
import type { InstalledApp } from '@/models/explore'
import type { VisionFile } from '@/types/app'
import type { I18nKeysByPrefix } from '@/types/i18n'
import {
  RiBookmark3Line,
  RiErrorWarningFill,
} from '@remixicon/react'
import { useBoolean } from 'ahooks'
import { useSearchParams } from 'next/navigation'
import * as React from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import SavedItems from '@/app/components/app/text-generate/saved-items'
import AppIcon from '@/app/components/base/app-icon'
import Badge from '@/app/components/base/badge'
import Loading from '@/app/components/base/loading'
import DifyLogo from '@/app/components/base/logo/dify-logo'
import Toast from '@/app/components/base/toast'
import Res from '@/app/components/share/text-generation/result'
import RunOnce from '@/app/components/share/text-generation/run-once'
import { appDefaultIconBackground } from '@/config'
import { useGlobalPublicStore } from '@/context/global-public-context'
import { useWebAppStore } from '@/context/web-app-context'
import { useAppFavicon } from '@/hooks/use-app-favicon'
import useBreakpoints, { MediaType } from '@/hooks/use-breakpoints'
import useDocumentTitle from '@/hooks/use-document-title'
import { AccessMode } from '@/models/access-control'
import { cn } from '@/utils/classnames'
import TabHeader from '../../base/tab-header'
import { TaskStatus, useBatchTasks } from './hooks/use-batch-tasks'
import { useSavedMessages } from './hooks/use-saved-messages'
import { useShareAppConfig } from './hooks/use-share-app-config'
import MenuDropdown from './menu-dropdown'
import RunBatch from './run-batch'
import ResDownload from './run-batch/res-download'

export type IMainProps = {
  isInstalledApp?: boolean
  installedAppInfo?: InstalledApp
  isWorkflow?: boolean
}

const TextGeneration: FC<IMainProps> = ({
  isInstalledApp = false,
  installedAppInfo,
  isWorkflow = false,
}) => {
  const { notify: rawNotify } = Toast
  // Adapter to match expected notify signature
  const notify = ({ type, message }: { type: string, message: string }) => {
    // Only allow valid types
    const validTypes = ['success', 'error', 'warning', 'info'] as const
    const toastType = validTypes.includes(type as any) ? type as typeof validTypes[number] : 'info'
    rawNotify({ type: toastType, message })
  }

  const { t } = useTranslation()
  // Adapter to ensure t matches expected signature
  const tForSavedMessages = React.useCallback(
    (key: string, options?: Record<string, any>) => t(key as I18nKeysByPrefix<'share'>, { ...options, ns: 'share' }),
    [t],
  )
  const media = useBreakpoints()
  const isPC = media === MediaType.pc

  const searchParams = useSearchParams()
  const mode = searchParams.get('mode') || 'create'
  const [currentTab, setCurrentTab] = useState<string>(['create', 'batch'].includes(mode) ? mode : 'create')

  // Notice this situation isCallBatchAPI but not in batch tab
  const isInBatchTab = currentTab === 'batch'
  const [inputs, doSetInputs] = useState<Record<string, any>>({})
  const inputsRef = useRef(inputs)
  const setInputs = useCallback((newInputs: Record<string, any>) => {
    doSetInputs(newInputs)
    inputsRef.current = newInputs
  }, [])
  const systemFeatures = useGlobalPublicStore(s => s.systemFeatures)

  // send message task
  const [controlSend, setControlSend] = useState(0)
  const [controlStopResponding, setControlStopResponding] = useState(0)
  const [completionFiles, setCompletionFiles] = useState<VisionFile[]>([])
  const [runControl, setRunControl] = useState<{ onStop: () => Promise<void> | void, isStopping: boolean } | null>(null)
  const [isShowResultPanel, { setTrue: doShowResultPanel, setFalse: hideResultPanel }] = useBoolean(false)
  const showResultPanel = useCallback(() => {
    // fix: useClickAway hideResSidebar will close sidebar
    setTimeout(() => {
      doShowResultPanel()
    }, 0)
  }, [doShowResultPanel])
  const [resultExisted, setResultExisted] = useState(false)

  const appData = useWebAppStore(s => s.appInfo)
  const appParams = useWebAppStore(s => s.appParams)
  const accessMode = useWebAppStore(s => s.webAppAccessMode)

  const {
    appId,
    siteInfo,
    customConfig,
    promptConfig,
    moreLikeThisConfig,
    textToSpeechConfig,
    visionConfig,
  } = useShareAppConfig({ appData, appParams })

  const {
    savedMessages,
    handleSaveMessage,
    handleRemoveSavedMessage,
  } = useSavedMessages({
    appId,
    isInstalledApp,
    isWorkflow,
    notify,
    t: tForSavedMessages,
  })

  const handleBatchStart = useCallback(() => {
    setControlSend(Date.now())
    // clear run once task status
    setControlStopResponding(Date.now())
    showResultPanel()
  }, [showResultPanel])

  const {
    isCallBatchAPI,
    allTaskList,
    noPendingTask,
    showTaskList,
    allSuccessTaskList,
    allFailedTaskList,
    allTasksRun,
    exportRes,
    controlRetry,
    handleRetryAllFailedTask,
    handleRunBatch,
    handleCompleted,
    resetBatchTasks,
  } = useBatchTasks({
    promptConfig,
    notify,
    t: tForSavedMessages,
    onBatchStart: handleBatchStart,
  })

  useEffect(() => {
    if (isCallBatchAPI)
      setRunControl(null)
  }, [isCallBatchAPI])

  const handleSend = () => {
    setControlSend(Date.now())
    resetBatchTasks()
    showResultPanel()
  }

  // Can Use metadata(https://beta.nextjs.org/docs/api-reference/metadata) to set title. But it only works in server side client.
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
      isInstalledApp={isInstalledApp}
      appId={appId}
      installedAppInfo={installedAppInfo}
      isError={task?.status === TaskStatus.failed}
      promptConfig={promptConfig}
      moreLikeThisEnabled={!!moreLikeThisConfig?.enabled}
      inputs={isCallBatchAPI ? (task as Task).params.inputs : inputs}
      controlSend={controlSend}
      controlRetry={task?.status === TaskStatus.failed ? controlRetry : 0}
      controlStopResponding={controlStopResponding}
      onShowRes={showResultPanel}
      handleSaveMessage={handleSaveMessage}
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

  const renderBatchRes = () => {
    return (showTaskList.map(task => renderRes(task)))
  }

  const badge = (
    <Badge className="ml-1">
      {savedMessages.length}
    </Badge>
  )
  const saveTab = {
    id: 'saved',
    name: t('generation.tabs.saved', { ns: 'share' }),
    isRight: true,
    icon: <RiBookmark3Line className="h-4 w-4" />,
    extra: savedMessages.length > 0
      ? badge
      : null,
  }

  const renderResWrap = (
    <div
      className={cn(
        'relative flex h-full flex-col',
        !isPC && 'h-[calc(100vh_-_36px)] rounded-t-2xl shadow-lg backdrop-blur-sm',
        !isPC
          ? isShowResultPanel
            ? 'bg-background-default-burn'
            : 'border-t-[0.5px] border-divider-regular bg-components-panel-bg'
          : 'bg-chatbot-bg',
      )}
    >
      {isCallBatchAPI && (
        <div className={cn(
          'flex shrink-0 items-center justify-between px-14 pb-2 pt-9',
          !isPC && 'px-4 pb-1 pt-3',
        )}
        >
          <div className="system-md-semibold-uppercase text-text-primary">{t('generation.executions', { ns: 'share', num: allTaskList.length })}</div>
          {allSuccessTaskList.length > 0 && (
            <ResDownload
              isMobile={!isPC}
              values={exportRes}
            />
          )}
        </div>
      )}
      <div className={cn(
        'flex h-0 grow flex-col overflow-y-auto',
        isPC && 'px-14 py-8',
        isPC && isCallBatchAPI && 'pt-0',
        !isPC && 'p-0 pb-2',
      )}
      >
        {!isCallBatchAPI ? renderRes() : renderBatchRes()}
        {!noPendingTask && (
          <div className="mt-4">
            <Loading type="area" />
          </div>
        )}
      </div>
      {isCallBatchAPI && allFailedTaskList.length > 0 && (
        <div className="absolute bottom-6 left-1/2 z-10 flex -translate-x-1/2 items-center gap-2 rounded-xl border border-components-panel-border bg-components-panel-bg-blur p-3 shadow-lg backdrop-blur-sm">
          <RiErrorWarningFill className="h-4 w-4 text-text-destructive" />
          <div className="system-sm-medium text-text-secondary">{t('generation.batchFailed.info', { ns: 'share', num: allFailedTaskList.length })}</div>
          <div className="h-3.5 w-px bg-divider-regular"></div>
          <div onClick={handleRetryAllFailedTask} className="system-sm-semibold-uppercase cursor-pointer text-text-accent">{t('generation.batchFailed.retry', { ns: 'share' })}</div>
        </div>
      )}
    </div>
  )

  if (!appId || !siteInfo || !promptConfig) {
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
      {/* Left */}
      <div className={cn(
        'relative flex h-full shrink-0 flex-col',
        isPC ? 'w-[600px] max-w-[50%]' : resultExisted ? 'h-[calc(100%_-_64px)]' : '',
        isInstalledApp && 'rounded-l-2xl',
      )}
      >
        {/* header */}
        <div className={cn('shrink-0 space-y-4 border-b border-divider-subtle', isPC ? 'bg-components-panel-bg p-8 pb-0' : 'p-4 pb-0')}>
          <div className="flex items-center gap-3">
            <AppIcon
              size={isPC ? 'large' : 'small'}
              iconType={siteInfo.icon_type}
              icon={siteInfo.icon}
              background={siteInfo.icon_background || appDefaultIconBackground}
              imageUrl={siteInfo.icon_url}
            />
            <div className="system-md-semibold grow truncate text-text-secondary">{siteInfo.title}</div>
            <MenuDropdown hideLogout={isInstalledApp || accessMode === AccessMode.PUBLIC} data={siteInfo} />
          </div>
          {siteInfo.description && (
            <div className="system-xs-regular text-text-tertiary">{siteInfo.description}</div>
          )}
          <TabHeader
            items={[
              { id: 'create', name: t('generation.tabs.create', { ns: 'share' }) },
              { id: 'batch', name: t('generation.tabs.batch', { ns: 'share' }) },
              ...(!isWorkflow
                ? [saveTab]
                : []),
            ]}
            value={currentTab}
            onChange={setCurrentTab}
          />
        </div>
        {/* form */}
        <div className={cn(
          'h-0 grow overflow-y-auto bg-components-panel-bg',
          isPC ? 'px-8' : 'px-4',
          !isPC && resultExisted && customConfig?.remove_webapp_brand && 'rounded-b-2xl border-b-[0.5px] border-divider-regular',
        )}
        >
          <div className={cn(currentTab === 'create' ? 'block' : 'hidden')}>
            <RunOnce
              siteInfo={siteInfo}
              inputs={inputs}
              inputsRef={inputsRef}
              onInputsChange={setInputs}
              promptConfig={promptConfig}
              onSend={handleSend}
              visionConfig={visionConfig}
              onVisionFilesChange={setCompletionFiles}
              runControl={runControl}
            />
          </div>
          <div className={cn(isInBatchTab ? 'block' : 'hidden')}>
            <RunBatch
              vars={promptConfig.prompt_variables}
              onSend={handleRunBatch}
              isAllFinished={allTasksRun}
            />
          </div>
          {currentTab === 'saved' && (
            <SavedItems
              className={cn(isPC ? 'mt-6' : 'mt-4')}
              isShowTextToSpeech={textToSpeechConfig?.enabled}
              list={savedMessages}
              onRemove={handleRemoveSavedMessage}
              onStartCreateContent={() => setCurrentTab('create')}
            />
          )}
        </div>
        {/* powered by */}
        {!customConfig?.remove_webapp_brand && (
          <div className={cn(
            'flex shrink-0 items-center gap-1.5 bg-components-panel-bg py-3',
            isPC ? 'px-8' : 'px-4',
            !isPC && resultExisted && 'rounded-b-2xl border-b-[0.5px] border-divider-regular',
          )}
          >
            <div className="system-2xs-medium-uppercase text-text-tertiary">{t('chat.poweredBy', { ns: 'share' })}</div>
            {
              systemFeatures.branding.enabled && systemFeatures.branding.workspace_logo
                ? <img src={systemFeatures.branding.workspace_logo} alt="logo" className="block h-5 w-auto" />
                : customConfig?.replace_webapp_logo
                  ? <img src={`${customConfig?.replace_webapp_logo}`} alt="logo" className="block h-5 w-auto" />
                  : <DifyLogo size="small" />
            }
          </div>
        )}
      </div>
      {/* Result */}
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
            onClick={() => {
              if (isShowResultPanel)
                hideResultPanel()
              else
                showResultPanel()
            }}
          >
            <div className="h-1 w-8 cursor-grab rounded bg-divider-solid" />
          </div>
        )}
        {renderResWrap}
      </div>
    </div>
  )
}

export default TextGeneration
