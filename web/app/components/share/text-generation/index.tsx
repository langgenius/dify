'use client'
import type { FC } from 'react'
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  RiBookmark3Line,
  RiErrorWarningFill,
} from '@remixicon/react'
import { useBoolean } from 'ahooks'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import TabHeader from '../../base/tab-header'
import { checkOrSetAccessToken } from '../utils'
import MenuDropdown from './menu-dropdown'
import RunBatch from './run-batch'
import ResDownload from './run-batch/res-download'
import useBreakpoints, { MediaType } from '@/hooks/use-breakpoints'
import RunOnce from '@/app/components/share/text-generation/run-once'
import { fetchSavedMessage as doFetchSavedMessage, fetchAppInfo, fetchAppParams, removeMessage, saveMessage } from '@/service/share'
import type { SiteInfo } from '@/models/share'
import type {
  MoreLikeThisConfig,
  PromptConfig,
  SavedMessage,
  TextToSpeechConfig,
} from '@/models/debug'
import AppIcon from '@/app/components/base/app-icon'
import Badge from '@/app/components/base/badge'
import { changeLanguage } from '@/i18n/i18next-config'
import Loading from '@/app/components/base/loading'
import { userInputsFormToPromptVariables } from '@/utils/model-config'
import Res from '@/app/components/share/text-generation/result'
import SavedItems from '@/app/components/app/text-generate/saved-items'
import type { InstalledApp } from '@/models/explore'
import { DEFAULT_VALUE_MAX_LEN, appDefaultIconBackground } from '@/config'
import Toast from '@/app/components/base/toast'
import type { VisionFile, VisionSettings } from '@/types/app'
import { Resolution, TransferMethod } from '@/types/app'
import { useAppFavicon } from '@/hooks/use-app-favicon'
import LogoSite from '@/app/components/base/logo/logo-site'
import cn from '@/utils/classnames'

const GROUP_SIZE = 5 // to avoid RPM(Request per minute) limit. The group task finished then the next group.
enum TaskStatus {
  pending = 'pending',
  running = 'running',
  completed = 'completed',
  failed = 'failed',
}

type TaskParam = {
  inputs: Record<string, any>
}

type Task = {
  id: number
  status: TaskStatus
  params: TaskParam
}

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
  const { notify } = Toast

  const { t } = useTranslation()
  const media = useBreakpoints()
  const isPC = media === MediaType.pc

  const searchParams = useSearchParams()
  const mode = searchParams.get('mode') || 'create'
  const [currentTab, setCurrentTab] = useState<string>(['create', 'batch'].includes(mode) ? mode : 'create')

  const router = useRouter()
  const pathname = usePathname()
  useEffect(() => {
    const params = new URLSearchParams(searchParams)
    if (params.has('mode')) {
      params.delete('mode')
      router.replace(`${pathname}?${params.toString()}`)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Notice this situation isCallBatchAPI but not in batch tab
  const [isCallBatchAPI, setIsCallBatchAPI] = useState(false)
  const isInBatchTab = currentTab === 'batch'
  const [inputs, doSetInputs] = useState<Record<string, any>>({})
  const inputsRef = useRef(inputs)
  const setInputs = useCallback((newInputs: Record<string, any>) => {
    doSetInputs(newInputs)
    inputsRef.current = newInputs
  }, [])
  const [appId, setAppId] = useState<string>('')
  const [siteInfo, setSiteInfo] = useState<SiteInfo | null>(null)
  const [canReplaceLogo, setCanReplaceLogo] = useState<boolean>(false)
  const [customConfig, setCustomConfig] = useState<Record<string, any> | null>(null)
  const [promptConfig, setPromptConfig] = useState<PromptConfig | null>(null)
  const [moreLikeThisConfig, setMoreLikeThisConfig] = useState<MoreLikeThisConfig | null>(null)
  const [textToSpeechConfig, setTextToSpeechConfig] = useState<TextToSpeechConfig | null>(null)

  // save message
  const [savedMessages, setSavedMessages] = useState<SavedMessage[]>([])
  const fetchSavedMessage = async () => {
    const res: any = await doFetchSavedMessage(isInstalledApp, installedAppInfo?.id)
    setSavedMessages(res.data)
  }
  const handleSaveMessage = async (messageId: string) => {
    await saveMessage(messageId, isInstalledApp, installedAppInfo?.id)
    notify({ type: 'success', message: t('common.api.saved') })
    fetchSavedMessage()
  }
  const handleRemoveSavedMessage = async (messageId: string) => {
    await removeMessage(messageId, isInstalledApp, installedAppInfo?.id)
    notify({ type: 'success', message: t('common.api.remove') })
    fetchSavedMessage()
  }

  // send message task
  const [controlSend, setControlSend] = useState(0)
  const [controlStopResponding, setControlStopResponding] = useState(0)
  const [visionConfig, setVisionConfig] = useState<VisionSettings>({
    enabled: false,
    number_limits: 2,
    detail: Resolution.low,
    transfer_methods: [TransferMethod.local_file],
  })
  const [completionFiles, setCompletionFiles] = useState<VisionFile[]>([])

  const handleSend = () => {
    setIsCallBatchAPI(false)
    setControlSend(Date.now())

    // eslint-disable-next-line ts/no-use-before-define
    setAllTaskList([]) // clear batch task running status

    // eslint-disable-next-line ts/no-use-before-define
    showResultPanel()
  }

  const [controlRetry, setControlRetry] = useState(0)
  const handleRetryAllFailedTask = () => {
    setControlRetry(Date.now())
  }
  const [allTaskList, doSetAllTaskList] = useState<Task[]>([])
  const allTaskListRef = useRef<Task[]>([])
  const getLatestTaskList = () => allTaskListRef.current
  const setAllTaskList = (taskList: Task[]) => {
    doSetAllTaskList(taskList)
    allTaskListRef.current = taskList
  }
  const pendingTaskList = allTaskList.filter(task => task.status === TaskStatus.pending)
  const noPendingTask = pendingTaskList.length === 0
  const showTaskList = allTaskList.filter(task => task.status !== TaskStatus.pending)
  const [currGroupNum, doSetCurrGroupNum] = useState(0)
  const currGroupNumRef = useRef(0)
  const setCurrGroupNum = (num: number) => {
    doSetCurrGroupNum(num)
    currGroupNumRef.current = num
  }
  const getCurrGroupNum = () => {
    return currGroupNumRef.current
  }
  const allSuccessTaskList = allTaskList.filter(task => task.status === TaskStatus.completed)
  const allFailedTaskList = allTaskList.filter(task => task.status === TaskStatus.failed)
  const allTasksFinished = allTaskList.every(task => task.status === TaskStatus.completed)
  const allTasksRun = allTaskList.every(task => [TaskStatus.completed, TaskStatus.failed].includes(task.status))
  const [batchCompletionRes, doSetBatchCompletionRes] = useState<Record<string, string>>({})
  const batchCompletionResRef = useRef<Record<string, string>>({})
  const setBatchCompletionRes = (res: Record<string, string>) => {
    doSetBatchCompletionRes(res)
    batchCompletionResRef.current = res
  }
  const getBatchCompletionRes = () => batchCompletionResRef.current
  const exportRes = allTaskList.map((task) => {
    const batchCompletionResLatest = getBatchCompletionRes()
    const res: Record<string, string> = {}
    const { inputs } = task.params
    promptConfig?.prompt_variables.forEach((v) => {
      res[v.name] = inputs[v.key]
    })
    let result = batchCompletionResLatest[task.id]
    // task might return multiple fields, should marshal object to string
    if (typeof batchCompletionResLatest[task.id] === 'object')
      result = JSON.stringify(result)

    res[t('share.generation.completionResult')] = result
    return res
  })
  const checkBatchInputs = (data: string[][]) => {
    if (!data || data.length === 0) {
      notify({ type: 'error', message: t('share.generation.errorMsg.empty') })
      return false
    }
    const headerData = data[0]
    let isMapVarName = true
    promptConfig?.prompt_variables.forEach((item, index) => {
      if (!isMapVarName)
        return

      if (item.name !== headerData[index])
        isMapVarName = false
    })

    if (!isMapVarName) {
      notify({ type: 'error', message: t('share.generation.errorMsg.fileStructNotMatch') })
      return false
    }

    let payloadData = data.slice(1)
    if (payloadData.length === 0) {
      notify({ type: 'error', message: t('share.generation.errorMsg.atLeastOne') })
      return false
    }

    // check middle empty line
    const allEmptyLineIndexes = payloadData.filter(item => item.every(i => i === '')).map(item => payloadData.indexOf(item))
    if (allEmptyLineIndexes.length > 0) {
      let hasMiddleEmptyLine = false
      let startIndex = allEmptyLineIndexes[0] - 1
      allEmptyLineIndexes.forEach((index) => {
        if (hasMiddleEmptyLine)
          return

        if (startIndex + 1 !== index) {
          hasMiddleEmptyLine = true
          return
        }
        startIndex++
      })

      if (hasMiddleEmptyLine) {
        notify({ type: 'error', message: t('share.generation.errorMsg.emptyLine', { rowIndex: startIndex + 2 }) })
        return false
      }
    }

    // check row format
    payloadData = payloadData.filter(item => !item.every(i => i === ''))
    // after remove empty rows in the end, checked again
    if (payloadData.length === 0) {
      notify({ type: 'error', message: t('share.generation.errorMsg.atLeastOne') })
      return false
    }
    let errorRowIndex = 0
    let requiredVarName = ''
    let moreThanMaxLengthVarName = ''
    let maxLength = 0
    payloadData.forEach((item, index) => {
      if (errorRowIndex !== 0)
        return

      promptConfig?.prompt_variables.forEach((varItem, varIndex) => {
        if (errorRowIndex !== 0)
          return
        if (varItem.type === 'string') {
          const maxLen = varItem.max_length || DEFAULT_VALUE_MAX_LEN
          if (item[varIndex].length > maxLen) {
            moreThanMaxLengthVarName = varItem.name
            maxLength = maxLen
            errorRowIndex = index + 1
            return
          }
        }
        if (!varItem.required)
          return

        if (item[varIndex].trim() === '') {
          requiredVarName = varItem.name
          errorRowIndex = index + 1
        }
      })
    })

    if (errorRowIndex !== 0) {
      if (requiredVarName)
        notify({ type: 'error', message: t('share.generation.errorMsg.invalidLine', { rowIndex: errorRowIndex + 1, varName: requiredVarName }) })

      if (moreThanMaxLengthVarName)
        notify({ type: 'error', message: t('share.generation.errorMsg.moreThanMaxLengthLine', { rowIndex: errorRowIndex + 1, varName: moreThanMaxLengthVarName, maxLength }) })

      return false
    }
    return true
  }
  const handleRunBatch = (data: string[][]) => {
    if (!checkBatchInputs(data))
      return
    if (!allTasksFinished) {
      notify({ type: 'info', message: t('appDebug.errorMessage.waitForBatchResponse') })
      return
    }

    const payloadData = data.filter(item => !item.every(i => i === '')).slice(1)
    const varLen = promptConfig?.prompt_variables.length || 0
    setIsCallBatchAPI(true)
    const allTaskList: Task[] = payloadData.map((item, i) => {
      const inputs: Record<string, string> = {}
      if (varLen > 0) {
        item.slice(0, varLen).forEach((input, index) => {
          inputs[promptConfig?.prompt_variables[index].key as string] = input
        })
      }
      return {
        id: i + 1,
        status: i < GROUP_SIZE ? TaskStatus.running : TaskStatus.pending,
        params: {
          inputs,
        },
      }
    })
    setAllTaskList(allTaskList)
    setCurrGroupNum(0)
    setControlSend(Date.now())
    // clear run once task status
    setControlStopResponding(Date.now())

    // eslint-disable-next-line ts/no-use-before-define
    showResultPanel()
  }
  const handleCompleted = (completionRes: string, taskId?: number, isSuccess?: boolean) => {
    const allTaskListLatest = getLatestTaskList()
    const batchCompletionResLatest = getBatchCompletionRes()
    const pendingTaskList = allTaskListLatest.filter(task => task.status === TaskStatus.pending)
    const runTasksCount = 1 + allTaskListLatest.filter(task => [TaskStatus.completed, TaskStatus.failed].includes(task.status)).length
    const needToAddNextGroupTask = (getCurrGroupNum() !== runTasksCount) && pendingTaskList.length > 0 && (runTasksCount % GROUP_SIZE === 0 || (allTaskListLatest.length - runTasksCount < GROUP_SIZE))
    // avoid add many task at the same time
    if (needToAddNextGroupTask)
      setCurrGroupNum(runTasksCount)

    const nextPendingTaskIds = needToAddNextGroupTask ? pendingTaskList.slice(0, GROUP_SIZE).map(item => item.id) : []
    const newAllTaskList = allTaskListLatest.map((item) => {
      if (item.id === taskId) {
        return {
          ...item,
          status: isSuccess ? TaskStatus.completed : TaskStatus.failed,
        }
      }
      if (needToAddNextGroupTask && nextPendingTaskIds.includes(item.id)) {
        return {
          ...item,
          status: TaskStatus.running,
        }
      }
      return item
    })
    setAllTaskList(newAllTaskList)
    if (taskId) {
      setBatchCompletionRes({
        ...batchCompletionResLatest,
        [`${taskId}`]: completionRes,
      })
    }
  }

  const fetchInitData = async () => {
    if (!isInstalledApp)
      await checkOrSetAccessToken()

    return Promise.all([
      isInstalledApp
        ? {
          app_id: installedAppInfo?.id,
          site: {
            title: installedAppInfo?.app.name,
            prompt_public: false,
            copyright: '',
            icon: installedAppInfo?.app.icon,
            icon_background: installedAppInfo?.app.icon_background,
          },
          plan: 'basic',
        }
        : fetchAppInfo(),
      fetchAppParams(isInstalledApp, installedAppInfo?.id),
      !isWorkflow
        ? fetchSavedMessage()
        : {},
    ])
  }

  useEffect(() => {
    (async () => {
      const [appData, appParams]: any = await fetchInitData()
      const { app_id: appId, site: siteInfo, can_replace_logo, custom_config } = appData
      setAppId(appId)
      setSiteInfo(siteInfo as SiteInfo)
      setCanReplaceLogo(can_replace_logo)
      setCustomConfig(custom_config)
      changeLanguage(siteInfo.default_language)

      const { user_input_form, more_like_this, file_upload, text_to_speech }: any = appParams
      setVisionConfig({
        // legacy of image upload compatible
        ...file_upload,
        transfer_methods: file_upload.allowed_file_upload_methods || file_upload.allowed_upload_methods,
        // legacy of image upload compatible
        image_file_size_limit: appParams?.system_parameters?.image_file_size_limit,
        fileUploadConfig: appParams?.system_parameters,
      })
      const prompt_variables = userInputsFormToPromptVariables(user_input_form)
      setPromptConfig({
        prompt_template: '', // placeholder for future
        prompt_variables,
      } as PromptConfig)
      setMoreLikeThisConfig(more_like_this)
      setTextToSpeechConfig(text_to_speech)
    })()
  }, [])

  // Can Use metadata(https://beta.nextjs.org/docs/api-reference/metadata) to set title. But it only works in server side client.
  useEffect(() => {
    if (siteInfo?.title) {
      if (canReplaceLogo)
        document.title = `${siteInfo.title}`
      else
        document.title = `${siteInfo.title} - Powered by Dify`
    }
  }, [siteInfo?.title, canReplaceLogo])

  useAppFavicon({
    enable: !isInstalledApp,
    icon_type: siteInfo?.icon_type,
    icon: siteInfo?.icon,
    icon_background: siteInfo?.icon_background,
    icon_url: siteInfo?.icon_url,
  })

  const [isShowResultPanel, { setTrue: doShowResultPanel, setFalse: hideResultPanel }] = useBoolean(false)
  const showResultPanel = () => {
    // fix: useClickAway hideResSidebar will close sidebar
    setTimeout(() => {
      doShowResultPanel()
    }, 0)
  }
  const [resultExisted, setResultExisted] = useState(false)

  const renderRes = (task?: Task) => (<Res
    key={task?.id}
    isWorkflow={isWorkflow}
    isCallBatchAPI={isCallBatchAPI}
    isPC={isPC}
    isMobile={!isPC}
    isInstalledApp={isInstalledApp}
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
  />)

  const renderBatchRes = () => {
    return (showTaskList.map(task => renderRes(task)))
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
        )}>
          <div className='system-md-semibold-uppercase text-text-primary'>{t('share.generation.executions', { num: allTaskList.length })}</div>
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
      )}>
        {!isCallBatchAPI ? renderRes() : renderBatchRes()}
        {!noPendingTask && (
          <div className='mt-4'>
            <Loading type='area' />
          </div>
        )}
      </div>
      {isCallBatchAPI && allFailedTaskList.length > 0 && (
        <div className='absolute bottom-6 left-1/2 z-10 flex -translate-x-1/2 items-center gap-2 rounded-xl border border-components-panel-border bg-components-panel-bg-blur p-3 shadow-lg backdrop-blur-sm'>
          <RiErrorWarningFill className='h-4 w-4 text-text-destructive' />
          <div className='system-sm-medium text-text-secondary'>{t('share.generation.batchFailed.info', { num: allFailedTaskList.length })}</div>
          <div className='h-3.5 w-px bg-divider-regular'></div>
          <div onClick={handleRetryAllFailedTask} className='system-sm-semibold-uppercase cursor-pointer text-text-accent'>{t('share.generation.batchFailed.retry')}</div>
        </div>
      )}
    </div>
  )

  if (!appId || !siteInfo || !promptConfig) {
    return (
      <div className='flex h-screen items-center'>
        <Loading type='app' />
      </div>)
  }

  return (
    <div className={cn(
      'bg-background-default-burn',
      isPC && 'flex',
      !isPC && 'flex-col',
      isInstalledApp ? 'h-full rounded-2xl shadow-md' : 'h-screen',
    )}>
      {/* Left */}
      <div className={cn(
        'relative flex h-full shrink-0 flex-col',
        isPC ? 'w-[600px] max-w-[50%]' : resultExisted ? 'h-[calc(100%_-_64px)]' : '',
        isInstalledApp && 'rounded-l-2xl',
      )}>
        {/* header */}
        <div className={cn('shrink-0 space-y-4 border-b border-divider-subtle', isPC ? 'bg-components-panel-bg p-8 pb-0' : 'p-4 pb-0')}>
          <div className='flex items-center gap-3'>
            <AppIcon
              size={isPC ? 'large' : 'small'}
              iconType={siteInfo.icon_type}
              icon={siteInfo.icon}
              background={siteInfo.icon_background || appDefaultIconBackground}
              imageUrl={siteInfo.icon_url}
            />
            <div className='system-md-semibold grow truncate text-text-secondary'>{siteInfo.title}</div>
            <MenuDropdown data={siteInfo} />
          </div>
          {siteInfo.description && (
            <div className='system-xs-regular text-text-tertiary'>{siteInfo.description}</div>
          )}
          <TabHeader
            items={[
              { id: 'create', name: t('share.generation.tabs.create') },
              { id: 'batch', name: t('share.generation.tabs.batch') },
              ...(!isWorkflow
                ? [{
                  id: 'saved',
                  name: t('share.generation.tabs.saved'),
                  isRight: true,
                  icon: <RiBookmark3Line className='h-4 w-4' />,
                  extra: savedMessages.length > 0
                    ? (
                      <Badge className='ml-1'>
                        {savedMessages.length}
                      </Badge>
                    )
                    : null,
                }]
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
        )}>
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
          )}>
            <div className='system-2xs-medium-uppercase text-text-tertiary'>{t('share.chat.poweredBy')}</div>
            {customConfig?.replace_webapp_logo && (
              <img src={customConfig?.replace_webapp_logo} alt='logo' className='block h-5 w-auto' />
            )}
            {!customConfig?.replace_webapp_logo && (
              <LogoSite className='!h-5' />
            )}
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
      )}>
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
            <div className='h-1 w-8 cursor-grab rounded bg-divider-solid'/>
          </div>
        )}
        {renderResWrap}
      </div>
    </div>
  )
}

export default TextGeneration
