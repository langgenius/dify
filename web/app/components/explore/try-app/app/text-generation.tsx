'use client'
import type { FC } from 'react'
import type { InputValueTypes, Task } from '../../../share/text-generation/types'
import type { MoreLikeThisConfig, PromptConfig, TextToSpeechConfig } from '@/models/debug'
import type { AppData, CustomConfigValueType, SiteInfo } from '@/models/share'
import type { VisionFile, VisionSettings } from '@/types/app'
import { useBoolean } from 'ahooks'
import { noop } from 'es-toolkit/function'
import * as React from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Alert from '@/app/components/base/alert'
import AppIcon from '@/app/components/base/app-icon'
import Loading from '@/app/components/base/loading'
import Res from '@/app/components/share/text-generation/result'
import { TaskStatus } from '@/app/components/share/text-generation/types'
import { appDefaultIconBackground } from '@/config'
import { useWebAppStore } from '@/context/web-app-context'
import useBreakpoints, { MediaType } from '@/hooks/use-breakpoints'
import { AppSourceType } from '@/service/share'
import { useGetTryAppParams } from '@/service/use-try-app'
import { Resolution, TransferMethod } from '@/types/app'
import { cn } from '@/utils/classnames'
import { userInputsFormToPromptVariables } from '@/utils/model-config'
import RunOnce from '../../../share/text-generation/run-once'

type Props = {
  appId: string
  className?: string
  isWorkflow?: boolean
  appData: AppData | null
}

const TextGeneration: FC<Props> = ({
  appId,
  className,
  isWorkflow,
  appData,
}) => {
  const { t } = useTranslation()
  const media = useBreakpoints()
  const isPC = media === MediaType.pc

  const [inputs, doSetInputs] = useState<Record<string, InputValueTypes>>({})
  const inputsRef = useRef<Record<string, InputValueTypes>>(inputs)
  const setInputs = useCallback((newInputs: Record<string, InputValueTypes>) => {
    doSetInputs(newInputs)
    inputsRef.current = newInputs
  }, [])

  const updateAppInfo = useWebAppStore(s => s.updateAppInfo)
  const { data: tryAppParams } = useGetTryAppParams(appId)

  const updateAppParams = useWebAppStore(s => s.updateAppParams)
  const appParams = useWebAppStore(s => s.appParams)
  const [siteInfo, setSiteInfo] = useState<SiteInfo | null>(null)
  const [promptConfig, setPromptConfig] = useState<PromptConfig | null>(null)
  const [customConfig, setCustomConfig] = useState<Record<string, CustomConfigValueType> | null>(null)
  const [moreLikeThisConfig, setMoreLikeThisConfig] = useState<MoreLikeThisConfig | null>(null)
  const [textToSpeechConfig, setTextToSpeechConfig] = useState<TextToSpeechConfig | null>(null)
  const [controlSend, setControlSend] = useState(0)
  const [visionConfig, setVisionConfig] = useState<VisionSettings>({
    enabled: false,
    number_limits: 2,
    detail: Resolution.low,
    transfer_methods: [TransferMethod.local_file],
  })
  const [completionFiles, setCompletionFiles] = useState<VisionFile[]>([])
  const [isShowResultPanel, { setTrue: doShowResultPanel, setFalse: hideResultPanel }] = useBoolean(false)
  const showResultPanel = () => {
    // fix: useClickAway hideResSidebar will close sidebar
    setTimeout(() => {
      doShowResultPanel()
    }, 0)
  }

  const handleSend = () => {
    setControlSend(Date.now())
    showResultPanel()
  }

  const [resultExisted, setResultExisted] = useState(false)

  useEffect(() => {
    if (!appData)
      return
    updateAppInfo(appData)
  }, [appData, updateAppInfo])

  useEffect(() => {
    if (!tryAppParams)
      return
    updateAppParams(tryAppParams)
  }, [tryAppParams, updateAppParams])

  useEffect(() => {
    (async () => {
      if (!appData || !appParams)
        return
      const { site: siteInfo, custom_config } = appData
      setSiteInfo(siteInfo as SiteInfo)
      setCustomConfig(custom_config)

      const { user_input_form, more_like_this, file_upload, text_to_speech } = appParams
      setVisionConfig({
        // legacy of image upload compatible
        ...file_upload,
        transfer_methods: file_upload?.allowed_file_upload_methods || file_upload?.allowed_upload_methods,
        // legacy of image upload compatible
        image_file_size_limit: appParams?.system_parameters.image_file_size_limit,
        fileUploadConfig: appParams?.system_parameters,
        // eslint-disable-next-line ts/no-explicit-any
      } as any)
      const prompt_variables = userInputsFormToPromptVariables(user_input_form)
      setPromptConfig({
        prompt_template: '', // placeholder for future
        prompt_variables,
      } as PromptConfig)
      setMoreLikeThisConfig(more_like_this)
      setTextToSpeechConfig(text_to_speech)
    })()
  }, [appData, appParams])

  const [isCompleted, setIsCompleted] = useState(false)
  const handleCompleted = useCallback(() => {
    setIsCompleted(true)
  }, [])
  const [isHideTryNotice, {
    setTrue: hideTryNotice,
  }] = useBoolean(false)

  const renderRes = (task?: Task) => (
    <Res
      key={task?.id}
      isWorkflow={!!isWorkflow}
      isCallBatchAPI={false}
      isPC={isPC}
      isMobile={!isPC}
      appSourceType={AppSourceType.tryApp}
      appId={appId}
      isError={task?.status === TaskStatus.failed}
      promptConfig={promptConfig}
      moreLikeThisEnabled={!!moreLikeThisConfig?.enabled}
      inputs={inputs}
      controlSend={controlSend}
      onShowRes={showResultPanel}
      handleSaveMessage={noop}
      taskId={task?.id}
      onCompleted={handleCompleted}
      visionConfig={visionConfig}
      completionFiles={completionFiles}
      isShowTextToSpeech={!!textToSpeechConfig?.enabled}
      siteInfo={siteInfo}
      onRunStart={() => setResultExisted(true)}
    />
  )

  const renderResWrap = (
    <div
      className={cn(
        'relative flex h-full flex-col',
        'rounded-r-2xl bg-chatbot-bg',
      )}
    >
      <div className={cn(
        'flex h-0 grow flex-col overflow-y-auto p-6',
      )}
      >
        {isCompleted && !isHideTryNotice && (
          <Alert className="mb-3 shrink-0" message={t('tryApp.tryInfo', { ns: 'explore' })} onHide={hideTryNotice} />
        )}
        {renderRes()}
      </div>
    </div>
  )

  if (!siteInfo || !promptConfig) {
    return (
      <div className={cn('flex h-screen items-center', className)}>
        <Loading type="app" />
      </div>
    )
  }

  return (
    <div className={cn(
      'rounded-2xl border border-components-panel-border bg-background-section-burn',
      isPC && 'flex',
      !isPC && 'flex-col',
      'h-full rounded-2xl shadow-md',
      className,
    )}
    >
      {/* Left */}
      <div className={cn(
        'relative flex h-full shrink-0 flex-col',
        isPC && 'w-[600px] max-w-[50%]',
        'rounded-l-2xl bg-components-panel-bg',
      )}
      >
        {/* Header */}
        <div className={cn('shrink-0 space-y-4 pb-2', isPC ? ' p-8 pb-0' : 'p-4 pb-0')}>
          <div className="flex items-center gap-3">
            <AppIcon
              size={isPC ? 'large' : 'small'}
              iconType={siteInfo.icon_type}
              icon={siteInfo.icon}
              background={siteInfo.icon_background || appDefaultIconBackground}
              imageUrl={siteInfo.icon_url}
            />
            <div className="system-md-semibold grow truncate text-text-secondary">{siteInfo.title}</div>
          </div>
          {siteInfo.description && (
            <div className="system-xs-regular text-text-tertiary">{siteInfo.description}</div>
          )}
        </div>
        {/* form */}
        <div className={cn(
          'h-0 grow overflow-y-auto',
          isPC ? 'px-8' : 'px-4',
          !isPC && resultExisted && customConfig?.remove_webapp_brand && 'rounded-b-2xl border-b-[0.5px] border-divider-regular',
        )}
        >
          <RunOnce
            siteInfo={siteInfo}
            inputs={inputs}
            inputsRef={inputsRef}
            onInputsChange={setInputs}
            promptConfig={promptConfig}
            onSend={handleSend}
            visionConfig={visionConfig}
            onVisionFilesChange={setCompletionFiles}
          />
        </div>
      </div>

      {/* Result */}
      <div className={cn('h-full w-0 grow')}>
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

export default React.memo(TextGeneration)
