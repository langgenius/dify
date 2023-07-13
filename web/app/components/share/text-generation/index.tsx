'use client'
import type { FC } from 'react'
import React, { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import cn from 'classnames'
import { useBoolean, useClickAway, useGetState } from 'ahooks'
import { XMarkIcon } from '@heroicons/react/24/outline'
import TabHeader from '../../base/tab-header'
import Button from '../../base/button'
import { checkOrSetAccessToken } from '../utils'
import s from './style.module.css'
import RunBatch from './run-batch'
import ResDownload from './run-batch/res-download'
import useBreakpoints, { MediaType } from '@/hooks/use-breakpoints'
import RunOnce from '@/app/components/share/text-generation/run-once'
import { fetchSavedMessage as doFetchSavedMessage, fetchAppInfo, fetchAppParams, removeMessage, saveMessage } from '@/service/share'
import type { SiteInfo } from '@/models/share'
import type { MoreLikeThisConfig, PromptConfig, SavedMessage } from '@/models/debug'
import AppIcon from '@/app/components/base/app-icon'
import { changeLanguage } from '@/i18n/i18next-config'
import Loading from '@/app/components/base/loading'
import { userInputsFormToPromptVariables } from '@/utils/model-config'
import Res from '@/app/components/share/text-generation/result'
import SavedItems from '@/app/components/app/text-generate/saved-items'
import type { InstalledApp } from '@/models/explore'
import { appDefaultIconBackground } from '@/config'
import Toast from '@/app/components/base/toast'
const PARALLEL_LIMIT = 5
enum TaskStatus {
  pending = 'pending',
  running = 'running',
  completed = 'completed',
}

type TaskParam = {
  inputs: Record<string, any>
  query: string
}

type Task = {
  id: number
  status: TaskStatus
  params: TaskParam
}

export type IMainProps = {
  isInstalledApp?: boolean
  installedAppInfo?: InstalledApp
}

const TextGeneration: FC<IMainProps> = ({
  isInstalledApp = false,
  installedAppInfo,
}) => {
  const { notify } = Toast

  const { t } = useTranslation()
  const media = useBreakpoints()
  const isPC = media === MediaType.pc
  const isTablet = media === MediaType.tablet
  const isMobile = media === MediaType.mobile

  const [currTab, setCurrTab] = useState<string>('create')
  // Notice this situation isCallBatchAPI but not in batch tab
  const [isCallBatchAPI, setIsCallBatchAPI] = useState(false)
  const isInBatchTab = currTab === 'batch'
  const [inputs, setInputs] = useState<Record<string, any>>({})
  const [query, setQuery] = useState('') // run once query content
  const [appId, setAppId] = useState<string>('')
  const [siteInfo, setSiteInfo] = useState<SiteInfo | null>(null)
  const [promptConfig, setPromptConfig] = useState<PromptConfig | null>(null)
  const [moreLikeThisConfig, setMoreLikeThisConfig] = useState<MoreLikeThisConfig | null>(null)

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
  const handleSend = () => {
    setIsCallBatchAPI(false)
    setControlSend(Date.now())
    // eslint-disable-next-line @typescript-eslint/no-use-before-define
    setAllTaskList([]) // clear batch task running status
    // eslint-disable-next-line @typescript-eslint/no-use-before-define
    showResSidebar()
  }

  const [allTaskList, setAllTaskList, getLatestTaskList] = useGetState<Task[]>([])
  const pendingTaskList = allTaskList.filter(task => task.status === TaskStatus.pending)
  const noPendingTask = pendingTaskList.length === 0
  const showTaskList = allTaskList.filter(task => task.status !== TaskStatus.pending)
  const allTaskFinished = allTaskList.every(task => task.status === TaskStatus.completed)
  const [batchCompletionRes, setBatchCompletionRes, getBatchCompletionRes] = useGetState<Record<string, string>>({})
  const exportRes = allTaskList.map((task) => {
    if (allTaskList.length > 0 && !allTaskFinished)
      return {}
    const batchCompletionResLatest = getBatchCompletionRes()
    const res: Record<string, string> = {}
    const { inputs, query } = task.params
    promptConfig?.prompt_variables.forEach((v) => {
      res[v.name] = inputs[v.key]
    })
    res[t('share.generation.queryTitle')] = query
    res[t('share.generation.completionResult')] = batchCompletionResLatest[task.id]
    return res
  })
  const checkBatchInputs = (data: string[][]) => {
    if (!data || data.length === 0) {
      notify({ type: 'error', message: t('share.generation.errorMsg.empty') })
      return false
    }
    const headerData = data[0]
    const varLen = promptConfig?.prompt_variables.length || 0
    let isMapVarName = true
    promptConfig?.prompt_variables.forEach((item, index) => {
      if (!isMapVarName)
        return

      if (item.name !== headerData[index])
        isMapVarName = false
    })

    if (headerData[varLen] !== t('share.generation.queryTitle'))
      isMapVarName = false

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
    payloadData.forEach((item, index) => {
      if (errorRowIndex !== 0)
        return

      promptConfig?.prompt_variables.forEach((varItem, varIndex) => {
        if (errorRowIndex !== 0)
          return
        if (varItem.required === false)
          return

        if (item[varIndex].trim() === '') {
          requiredVarName = varItem.name
          errorRowIndex = index + 1
        }
      })

      if (errorRowIndex !== 0)
        return

      if (item[varLen] === '') {
        requiredVarName = t('share.generation.queryTitle')
        errorRowIndex = index + 1
      }
    })

    if (errorRowIndex !== 0) {
      notify({ type: 'error', message: t('share.generation.errorMsg.invalidLine', { rowIndex: errorRowIndex + 1, varName: requiredVarName }) })
      return false
    }
    return true
  }
  const handleRunBatch = (data: string[][]) => {
    if (!checkBatchInputs(data))
      return
    if (!allTaskFinished) {
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
        status: i < PARALLEL_LIMIT ? TaskStatus.running : TaskStatus.pending,
        params: {
          inputs,
          query: item[varLen],
        },
      }
    })
    setAllTaskList(allTaskList)

    setControlSend(Date.now())
    // clear run once task status
    setControlStopResponding(Date.now())
    // eslint-disable-next-line @typescript-eslint/no-use-before-define
    showResSidebar()
  }
  const handleCompleted = (completionRes: string, taskId?: number) => {
    const allTasklistLatest = getLatestTaskList()
    const batchCompletionResLatest = getBatchCompletionRes()
    const pendingTaskList = allTasklistLatest.filter(task => task.status === TaskStatus.pending)
    const nextPendingTaskId = pendingTaskList[0]?.id
    // console.log(`start: ${allTasklistLatest.map(item => item.status).join(',')}`)
    const newAllTaskList = allTasklistLatest.map((item) => {
      if (item.id === taskId) {
        return {
          ...item,
          status: TaskStatus.completed,
        }
      }
      if (item.id === nextPendingTaskId) {
        return {
          ...item,
          status: TaskStatus.running,
        }
      }
      return item
    })
    // console.log(`end: ${newAllTaskList.map(item => item.status).join(',')}`)
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

    return Promise.all([isInstalledApp
      ? {
        app_id: installedAppInfo?.id,
        site: {
          title: installedAppInfo?.app.name,
          prompt_public: false,
          copyright: '',
        },
        plan: 'basic',
      }
      : fetchAppInfo(), fetchAppParams(isInstalledApp, installedAppInfo?.id), fetchSavedMessage()])
  }

  useEffect(() => {
    (async () => {
      const [appData, appParams]: any = await fetchInitData()
      const { app_id: appId, site: siteInfo } = appData
      setAppId(appId)
      setSiteInfo(siteInfo as SiteInfo)
      changeLanguage(siteInfo.default_language)

      const { user_input_form, more_like_this }: any = appParams
      const prompt_variables = userInputsFormToPromptVariables(user_input_form)
      setPromptConfig({
        prompt_template: '', // placeholder for feture
        prompt_variables,
      } as PromptConfig)
      setMoreLikeThisConfig(more_like_this)
    })()
  }, [])

  // Can Use metadata(https://beta.nextjs.org/docs/api-reference/metadata) to set title. But it only works in server side client.
  useEffect(() => {
    if (siteInfo?.title)
      document.title = `${siteInfo.title} - Powered by Dify`
  }, [siteInfo?.title])

  const [isShowResSidebar, { setTrue: showResSidebar, setFalse: hideResSidebar }] = useBoolean(false)
  const resRef = useRef<HTMLDivElement>(null)
  useClickAway(() => {
    hideResSidebar()
  }, resRef)

  const renderRes = (task?: Task) => (<Res
    key={task?.id}
    isCallBatchAPI={isCallBatchAPI}
    isPC={isPC}
    isMobile={isMobile}
    isInstalledApp={!!isInstalledApp}
    installedAppInfo={installedAppInfo}
    promptConfig={promptConfig}
    moreLikeThisEnabled={!!moreLikeThisConfig?.enabled}
    inputs={isCallBatchAPI ? (task as Task).params.inputs : inputs}
    query={isCallBatchAPI ? (task as Task).params.query : query}
    controlSend={controlSend}
    controlStopResponding={controlStopResponding}
    onShowRes={showResSidebar}
    handleSaveMessage={handleSaveMessage}
    taskId={task?.id}
    onCompleted={handleCompleted}
  />)

  const renderBatchRes = () => {
    return (showTaskList.map(task => renderRes(task)))
  }

  const renderResWrap = (
    <div
      ref={resRef}
      className={
        cn(
          'flex flex-col h-full shrink-0',
          isPC ? 'px-10 py-8' : 'bg-gray-50',
          isTablet && 'p-6', isMobile && 'p-4')
      }
    >
      <>
        <div className='shrink-0 flex items-center justify-between'>
          <div className='flex items-center space-x-3'>
            <div className={s.starIcon}></div>
            <div className='text-lg text-gray-800 font-semibold'>{t('share.generation.title')}</div>
          </div>
          <div className='flex items-center space-x-2'>
            {allTaskList.length > 0 && allTaskFinished && (
              <ResDownload
                isMobile={isMobile}
                values={exportRes}
              />
            )}
            {!isPC && (
              <div
                className='flex items-center justify-center cursor-pointer'
                onClick={hideResSidebar}
              >
                <XMarkIcon className='w-4 h-4 text-gray-800' />
              </div>
            )}
          </div>

        </div>

        <div className='grow overflow-y-auto'>
          {!isCallBatchAPI ? renderRes() : renderBatchRes()}
          {!noPendingTask && (
            <div className='mt-4'>
              <Loading type='area' />
            </div>
          )}
        </div>
      </>
    </div>
  )

  if (!appId || !siteInfo || !promptConfig)
    return <Loading type='app' />

  return (
    <>
      <div className={cn(
        isPC && 'flex',
        isInstalledApp ? s.installedApp : 'h-screen',
        'bg-gray-50',
      )}>
        {/* Left */}
        <div className={cn(
          isPC ? 'w-[600px] max-w-[50%] p-8' : 'p-4',
          isInstalledApp && 'rounded-l-2xl',
          'shrink-0 relative flex flex-col pb-10 h-full border-r border-gray-100 bg-white',
        )}>
          <div className='mb-6'>
            <div className='flex justify-between items-center'>
              <div className='flex items-center space-x-3'>
                <AppIcon size="small" icon={siteInfo.icon} background={siteInfo.icon_background || appDefaultIconBackground} />
                <div className='text-lg text-gray-800 font-semibold'>{siteInfo.title}</div>
              </div>
              {!isPC && (
                <Button
                  className='shrink-0 !h-8 !px-3 ml-2'
                  onClick={showResSidebar}
                >
                  <div className='flex items-center space-x-2 text-primary-600 text-[13px] font-medium'>
                    <div className={s.starIcon}></div>
                    <span>{t('share.generation.title')}</span>
                  </div>
                </Button>
              )}
            </div>
            {siteInfo.description && (
              <div className='mt-2 text-xs text-gray-500'>{siteInfo.description}</div>
            )}
          </div>
          <TabHeader
            items={[
              { id: 'create', name: t('share.generation.tabs.create') },
              { id: 'batch', name: t('share.generation.tabs.batch') },
              {
                id: 'saved',
                name: t('share.generation.tabs.saved'),
                isRight: true,
                extra: savedMessages.length > 0
                  ? (
                    <div className='ml-1 flext items-center h-5 px-1.5 rounded-md border border-gray-200 text-gray-500 text-xs font-medium'>
                      {savedMessages.length}
                    </div>
                  )
                  : null,
              },
            ]}
            value={currTab}
            onChange={setCurrTab}
          />
          <div className='grow h-20 overflow-y-auto'>
            <div className={cn(currTab === 'create' ? 'block' : 'hidden')}>
              <RunOnce
                siteInfo={siteInfo}
                inputs={inputs}
                onInputsChange={setInputs}
                promptConfig={promptConfig}
                query={query}
                onQueryChange={setQuery}
                onSend={handleSend}
              />
            </div>
            <div className={cn(isInBatchTab ? 'block' : 'hidden')}>
              <RunBatch
                vars={promptConfig.prompt_variables}
                onSend={handleRunBatch}
              />
            </div>

            {currTab === 'saved' && (
              <SavedItems
                className='mt-4'
                list={savedMessages}
                onRemove={handleRemoveSavedMessage}
                onStartCreateContent={() => setCurrTab('create')}
              />
            )}
          </div>

          {/* copyright */}
          <div className={cn(
            isInstalledApp ? 'left-[248px]' : 'left-8',
            'fixed  bottom-4  flex space-x-2 text-gray-400 font-normal text-xs',
          )}>
            <div className="">© {siteInfo.copyright || siteInfo.title} {(new Date()).getFullYear()}</div>
            {siteInfo.privacy_policy && (
              <>
                <div>·</div>
                <div>{t('share.chat.privacyPolicyLeft')}
                  <a
                    className='text-gray-500'
                    href={siteInfo.privacy_policy}
                    target='_blank'>{t('share.chat.privacyPolicyMiddle')}</a>
                  {t('share.chat.privacyPolicyRight')}
                </div>
              </>
            )}
          </div>
        </div>

        {/* Result */}
        {isPC && (
          <div className='grow h-full'>
            {renderResWrap}
          </div>
        )}

        {(!isPC && isShowResSidebar) && (
          <div
            className={cn('fixed z-50 inset-0', isTablet ? 'pl-[128px]' : 'pl-6')}
            style={{
              background: 'rgba(35, 56, 118, 0.2)',
            }}
          >
            {renderResWrap}
          </div>
        )}
      </div>
    </>
  )
}

export default TextGeneration
