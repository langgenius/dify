'use client'
import type { FC } from 'react'
import type { FeedbackType } from '@/app/components/base/chat/chat/type'
import type { WorkflowProcess } from '@/app/components/base/chat/types'
import type { FileEntity } from '@/app/components/base/file-uploader/types'
import type { PromptConfig } from '@/models/debug'
import type { SiteInfo } from '@/models/share'
import type { AppSourceType } from '@/service/share'
import type { VisionFile, VisionSettings } from '@/types/app'
import { RiLoader2Line } from '@remixicon/react'
import { useBoolean } from 'ahooks'
import { t } from 'i18next'
import { produce } from 'immer'
import * as React from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import TextGenerationRes from '@/app/components/app/text-generate/item'
import Button from '@/app/components/base/button'
import {
  getFilesInLogs,
  getProcessedFiles,
} from '@/app/components/base/file-uploader/utils'
import { StopCircle } from '@/app/components/base/icons/src/vender/solid/mediaAndDevices'
import Loading from '@/app/components/base/loading'
import Toast from '@/app/components/base/toast'
import NoData from '@/app/components/share/text-generation/no-data'
import { NodeRunningStatus, WorkflowRunningStatus } from '@/app/components/workflow/types'
import { TEXT_GENERATION_TIMEOUT_MS } from '@/config'
import { sendCompletionMessage, sendWorkflowMessage, stopChatMessageResponding, stopWorkflowMessage, updateFeedback } from '@/service/share'
import { TransferMethod } from '@/types/app'
import { sleep } from '@/utils'
import { formatBooleanInputs } from '@/utils/model-config'

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
  onRunControlChange?: (control: { onStop: () => Promise<void> | void, isStopping: boolean } | null) => void
  hideInlineStopButton?: boolean
}

const Result: FC<IResultProps> = ({
  isWorkflow,
  isCallBatchAPI,
  isPC,
  isMobile,
  appSourceType,
  appId,
  isError,
  isShowTextToSpeech,
  promptConfig,
  moreLikeThisEnabled,
  inputs,
  controlSend,
  controlRetry,
  controlStopResponding,
  onShowRes,
  handleSaveMessage,
  taskId,
  onCompleted,
  visionConfig,
  completionFiles,
  siteInfo,
  onRunStart,
  onRunControlChange,
  hideInlineStopButton = false,
}) => {
  const [isResponding, { setTrue: setRespondingTrue, setFalse: setRespondingFalse }] = useBoolean(false)
  const [completionRes, doSetCompletionRes] = useState<string>('')
  const completionResRef = useRef<string>('')
  const setCompletionRes = (res: string) => {
    completionResRef.current = res
    doSetCompletionRes(res)
  }
  const getCompletionRes = () => completionResRef.current
  const [workflowProcessData, doSetWorkflowProcessData] = useState<WorkflowProcess>()
  const workflowProcessDataRef = useRef<WorkflowProcess | undefined>(undefined)
  const setWorkflowProcessData = (data: WorkflowProcess) => {
    workflowProcessDataRef.current = data
    doSetWorkflowProcessData(data)
  }
  const getWorkflowProcessData = () => workflowProcessDataRef.current
  const [currentTaskId, setCurrentTaskId] = useState<string | null>(null)
  const [isStopping, setIsStopping] = useState(false)
  const abortControllerRef = useRef<AbortController | null>(null)
  const resetRunState = useCallback(() => {
    setCurrentTaskId(null)
    setIsStopping(false)
    abortControllerRef.current = null
    onRunControlChange?.(null)
  }, [onRunControlChange])

  useEffect(() => {
    const abortCurrentRequest = () => {
      abortControllerRef.current?.abort()
    }

    if (controlStopResponding) {
      abortCurrentRequest()
      setRespondingFalse()
      resetRunState()
    }

    return abortCurrentRequest
  }, [controlStopResponding, resetRunState, setRespondingFalse])

  const { notify } = Toast
  const isNoData = !completionRes

  const [messageId, setMessageId] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<FeedbackType>({
    rating: null,
  })

  const handleFeedback = async (feedback: FeedbackType) => {
    await updateFeedback({ url: `/messages/${messageId}/feedbacks`, body: { rating: feedback.rating, content: feedback.content } }, appSourceType, appId)
    setFeedback(feedback)
  }

  const logError = (message: string) => {
    notify({ type: 'error', message })
  }

  const handleStop = useCallback(async () => {
    if (!currentTaskId || isStopping)
      return
    setIsStopping(true)
    try {
      if (isWorkflow)
        await stopWorkflowMessage(appId!, currentTaskId, appSourceType, appId || '')
      else
        await stopChatMessageResponding(appId!, currentTaskId, appSourceType, appId || '')
      abortControllerRef.current?.abort()
    }
    catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      notify({ type: 'error', message })
    }
    finally {
      setIsStopping(false)
    }
  }, [appId, currentTaskId, appSourceType, appId, isStopping, isWorkflow, notify])

  useEffect(() => {
    if (!onRunControlChange)
      return
    if (isResponding && currentTaskId) {
      onRunControlChange({
        onStop: handleStop,
        isStopping,
      })
    }
    else {
      onRunControlChange(null)
    }
  }, [currentTaskId, handleStop, isResponding, isStopping, onRunControlChange])

  const checkCanSend = () => {
    // batch will check outer
    if (isCallBatchAPI)
      return true

    const prompt_variables = promptConfig?.prompt_variables
    if (!prompt_variables || prompt_variables?.length === 0) {
      if (completionFiles.find(item => item.transfer_method === TransferMethod.local_file && !item.upload_file_id)) {
        notify({ type: 'info', message: t('errorMessage.waitForFileUpload', { ns: 'appDebug' }) })
        return false
      }
      return true
    }

    let hasEmptyInput = ''
    const requiredVars = prompt_variables?.filter(({ key, name, required, type }) => {
      if (type === 'boolean' || type === 'checkbox')
        return false // boolean/checkbox input is not required
      const res = (!key || !key.trim()) || (!name || !name.trim()) || (required || required === undefined || required === null)
      return res
    }) || [] // compatible with old version
    requiredVars.forEach(({ key, name }) => {
      if (hasEmptyInput)
        return

      if (!inputs[key])
        hasEmptyInput = name
    })

    if (hasEmptyInput) {
      logError(t('errorMessage.valueOfVarRequired', { ns: 'appDebug', key: hasEmptyInput }))
      return false
    }

    if (completionFiles.find(item => item.transfer_method === TransferMethod.local_file && !item.upload_file_id)) {
      notify({ type: 'info', message: t('errorMessage.waitForFileUpload', { ns: 'appDebug' }) })
      return false
    }
    return !hasEmptyInput
  }

  const handleSend = async () => {
    if (isResponding) {
      notify({ type: 'info', message: t('errorMessage.waitForResponse', { ns: 'appDebug' }) })
      return false
    }

    if (!checkCanSend())
      return

    // Process inputs: convert file entities to API format
    const processedInputs = { ...formatBooleanInputs(promptConfig?.prompt_variables, inputs) }
    promptConfig?.prompt_variables.forEach((variable) => {
      const value = processedInputs[variable.key]
      if (variable.type === 'file' && value && typeof value === 'object' && !Array.isArray(value)) {
        // Convert single file entity to API format
        processedInputs[variable.key] = getProcessedFiles([value as FileEntity])[0]
      }
      else if (variable.type === 'file-list' && Array.isArray(value) && value.length > 0) {
        // Convert file entity array to API format
        processedInputs[variable.key] = getProcessedFiles(value as FileEntity[])
      }
    })

    const data: Record<string, any> = {
      inputs: processedInputs,
    }
    if (visionConfig.enabled && completionFiles && completionFiles?.length > 0) {
      data.files = completionFiles.map((item) => {
        if (item.transfer_method === TransferMethod.local_file) {
          return {
            ...item,
            url: '',
          }
        }
        return item
      })
    }

    setMessageId(null)
    setFeedback({
      rating: null,
    })
    setCompletionRes('')
    resetRunState()

    let res: string[] = []
    let tempMessageId = ''

    if (!isPC) {
      onShowRes()
      onRunStart()
    }

    setRespondingTrue()
    let isEnd = false
    let isTimeout = false;
    (async () => {
      await sleep(TEXT_GENERATION_TIMEOUT_MS)
      if (!isEnd) {
        setRespondingFalse()
        onCompleted(getCompletionRes(), taskId, false)
        resetRunState()
        isTimeout = true
      }
    })()

    if (isWorkflow) {
      sendWorkflowMessage(
        data,
        {
          onWorkflowStarted: ({ workflow_run_id, task_id }) => {
            tempMessageId = workflow_run_id
            setCurrentTaskId(task_id || null)
            setIsStopping(false)
            setWorkflowProcessData({
              status: WorkflowRunningStatus.Running,
              tracing: [],
              expand: false,
              resultText: '',
            })
          },
          onIterationStart: ({ data }) => {
            setWorkflowProcessData(produce(getWorkflowProcessData()!, (draft) => {
              draft.expand = true
              draft.tracing!.push({
                ...data,
                status: NodeRunningStatus.Running,
                expand: true,
              })
            }))
          },
          onIterationNext: () => {
            setWorkflowProcessData(produce(getWorkflowProcessData()!, (draft) => {
              draft.expand = true
              const iterations = draft.tracing.find(item => item.node_id === data.node_id
                && (item.execution_metadata?.parallel_id === data.execution_metadata?.parallel_id || item.parallel_id === data.execution_metadata?.parallel_id))!
              iterations?.details!.push([])
            }))
          },
          onIterationFinish: ({ data }) => {
            setWorkflowProcessData(produce(getWorkflowProcessData()!, (draft) => {
              draft.expand = true
              const iterationsIndex = draft.tracing.findIndex(item => item.node_id === data.node_id
                && (item.execution_metadata?.parallel_id === data.execution_metadata?.parallel_id || item.parallel_id === data.execution_metadata?.parallel_id))!
              draft.tracing[iterationsIndex] = {
                ...data,
                expand: !!data.error,
              }
            }))
          },
          onLoopStart: ({ data }) => {
            setWorkflowProcessData(produce(getWorkflowProcessData()!, (draft) => {
              draft.expand = true
              draft.tracing!.push({
                ...data,
                status: NodeRunningStatus.Running,
                expand: true,
              })
            }))
          },
          onLoopNext: () => {
            setWorkflowProcessData(produce(getWorkflowProcessData()!, (draft) => {
              draft.expand = true
              const loops = draft.tracing.find(item => item.node_id === data.node_id
                && (item.execution_metadata?.parallel_id === data.execution_metadata?.parallel_id || item.parallel_id === data.execution_metadata?.parallel_id))!
              loops?.details!.push([])
            }))
          },
          onLoopFinish: ({ data }) => {
            setWorkflowProcessData(produce(getWorkflowProcessData()!, (draft) => {
              draft.expand = true
              const loopsIndex = draft.tracing.findIndex(item => item.node_id === data.node_id
                && (item.execution_metadata?.parallel_id === data.execution_metadata?.parallel_id || item.parallel_id === data.execution_metadata?.parallel_id))!
              draft.tracing[loopsIndex] = {
                ...data,
                expand: !!data.error,
              }
            }))
          },
          onNodeStarted: ({ data }) => {
            if (data.iteration_id)
              return

            if (data.loop_id)
              return

            setWorkflowProcessData(produce(getWorkflowProcessData()!, (draft) => {
              draft.expand = true
              draft.tracing!.push({
                ...data,
                status: NodeRunningStatus.Running,
                expand: true,
              })
            }))
          },
          onNodeFinished: ({ data }) => {
            if (data.iteration_id)
              return

            if (data.loop_id)
              return

            setWorkflowProcessData(produce(getWorkflowProcessData()!, (draft) => {
              const currentIndex = draft.tracing!.findIndex(trace => trace.node_id === data.node_id
                && (trace.execution_metadata?.parallel_id === data.execution_metadata?.parallel_id || trace.parallel_id === data.execution_metadata?.parallel_id))
              if (currentIndex > -1 && draft.tracing) {
                draft.tracing[currentIndex] = {
                  ...(draft.tracing[currentIndex].extras
                    ? { extras: draft.tracing[currentIndex].extras }
                    : {}),
                  ...data,
                  expand: !!data.error,
                }
              }
            }))
          },
          onWorkflowFinished: ({ data }) => {
            if (isTimeout) {
              notify({ type: 'warning', message: t('warningMessage.timeoutExceeded', { ns: 'appDebug' }) })
              return
            }
            const workflowStatus = data.status as WorkflowRunningStatus | undefined
            const markNodesStopped = (traces?: WorkflowProcess['tracing']) => {
              if (!traces)
                return
              const markTrace = (trace: WorkflowProcess['tracing'][number]) => {
                if ([NodeRunningStatus.Running, NodeRunningStatus.Waiting].includes(trace.status as NodeRunningStatus))
                  trace.status = NodeRunningStatus.Stopped
                trace.details?.forEach(detailGroup => detailGroup.forEach(markTrace))
                trace.retryDetail?.forEach(markTrace)
                trace.parallelDetail?.children?.forEach(markTrace)
              }
              traces.forEach(markTrace)
            }
            if (workflowStatus === WorkflowRunningStatus.Stopped) {
              setWorkflowProcessData(produce(getWorkflowProcessData()!, (draft) => {
                draft.status = WorkflowRunningStatus.Stopped
                markNodesStopped(draft.tracing)
              }))
              setRespondingFalse()
              resetRunState()
              onCompleted(getCompletionRes(), taskId, false)
              isEnd = true
              return
            }
            if (data.error) {
              notify({ type: 'error', message: data.error })
              setWorkflowProcessData(produce(getWorkflowProcessData()!, (draft) => {
                draft.status = WorkflowRunningStatus.Failed
                markNodesStopped(draft.tracing)
              }))
              setRespondingFalse()
              resetRunState()
              onCompleted(getCompletionRes(), taskId, false)
              isEnd = true
              return
            }
            setWorkflowProcessData(produce(getWorkflowProcessData()!, (draft) => {
              draft.status = WorkflowRunningStatus.Succeeded
              draft.files = getFilesInLogs(data.outputs || []) as any[]
            }))
            if (!data.outputs) {
              setCompletionRes('')
            }
            else {
              setCompletionRes(data.outputs)
              const isStringOutput = Object.keys(data.outputs).length === 1 && typeof data.outputs[Object.keys(data.outputs)[0]] === 'string'
              if (isStringOutput) {
                setWorkflowProcessData(produce(getWorkflowProcessData()!, (draft) => {
                  draft.resultText = data.outputs[Object.keys(data.outputs)[0]]
                }))
              }
            }
            setRespondingFalse()
            resetRunState()
            setMessageId(tempMessageId)
            onCompleted(getCompletionRes(), taskId, true)
            isEnd = true
          },
          onTextChunk: (params) => {
            const { data: { text } } = params
            setWorkflowProcessData(produce(getWorkflowProcessData()!, (draft) => {
              draft.resultText += text
            }))
          },
          onTextReplace: (params) => {
            const { data: { text } } = params
            setWorkflowProcessData(produce(getWorkflowProcessData()!, (draft) => {
              draft.resultText = text
            }))
          },
        },
        appSourceType,
        appId,
      ).catch((error) => {
        setRespondingFalse()
        resetRunState()
        const message = error instanceof Error ? error.message : String(error)
        notify({ type: 'error', message })
      })
    }
    else {
      sendCompletionMessage(data, {
        onData: (data: string, _isFirstMessage: boolean, { messageId, taskId }) => {
          tempMessageId = messageId
          if (taskId && typeof taskId === 'string' && taskId.trim() !== '')
            setCurrentTaskId(prev => prev ?? taskId)
          res.push(data)
          setCompletionRes(res.join(''))
        },
        onCompleted: () => {
          if (isTimeout) {
            notify({ type: 'warning', message: t('warningMessage.timeoutExceeded', { ns: 'appDebug' }) })
            return
          }
          setRespondingFalse()
          resetRunState()
          setMessageId(tempMessageId)
          onCompleted(getCompletionRes(), taskId, true)
          isEnd = true
        },
        onMessageReplace: (messageReplace) => {
          res = [messageReplace.answer]
          setCompletionRes(res.join(''))
        },
        onError() {
          if (isTimeout) {
            notify({ type: 'warning', message: t('warningMessage.timeoutExceeded', { ns: 'appDebug' }) })
            return
          }
          setRespondingFalse()
          resetRunState()
          onCompleted(getCompletionRes(), taskId, false)
          isEnd = true
        },
        getAbortController: (abortController) => {
          abortControllerRef.current = abortController
        },
      }, appSourceType, appId)
    }
  }

  const [controlClearMoreLikeThis, setControlClearMoreLikeThis] = useState(0)
  useEffect(() => {
    if (controlSend) {
      handleSend()
      setControlClearMoreLikeThis(Date.now())
    }
  }, [controlSend])

  useEffect(() => {
    if (controlRetry)
      handleSend()
  }, [controlRetry])

  const renderTextGenerationRes = () => (
    <>
      {!hideInlineStopButton && isResponding && currentTaskId && (
        <div className={`mb-3 flex ${isPC ? 'justify-end' : 'justify-center'}`}>
          <Button
            variant="secondary"
            disabled={isStopping}
            onClick={handleStop}
          >
            {
              isStopping
                ? <RiLoader2Line className="mr-[5px] h-3.5 w-3.5 animate-spin" />
                : <StopCircle className="mr-[5px] h-3.5 w-3.5" />
            }
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

  return (
    <>
      {!isCallBatchAPI && !isWorkflow && (
        (isResponding && !completionRes)
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
            )
      )}
      {!isCallBatchAPI && isWorkflow && (
        (isResponding && !workflowProcessData)
          ? (
              <div className="flex h-full w-full items-center justify-center">
                <Loading type="area" />
              </div>
            )
          : !workflowProcessData
              ? <NoData />
              : renderTextGenerationRes()
      )}
      {isCallBatchAPI && renderTextGenerationRes()}
    </>
  )
}
export default React.memo(Result)
