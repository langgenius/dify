import type { InputValueTypes } from '../../types'
import type { FeedbackType } from '@/app/components/base/chat/chat/type'
import type { WorkflowProcess } from '@/app/components/base/chat/types'
import type { FileEntity } from '@/app/components/base/file-uploader/types'
import type { PromptConfig } from '@/models/debug'
import type { AppSourceType } from '@/service/share'
import type { VisionFile, VisionSettings } from '@/types/app'
import { useBoolean } from 'ahooks'
import { t } from 'i18next'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  getProcessedFiles,
} from '@/app/components/base/file-uploader/utils'
import Toast from '@/app/components/base/toast'
import { TEXT_GENERATION_TIMEOUT_MS } from '@/config'
import {
  sendCompletionMessage,
  sendWorkflowMessage,
  stopChatMessageResponding,
  stopWorkflowMessage,
  updateFeedback,
} from '@/service/share'
import { TransferMethod } from '@/types/app'
import { sleep } from '@/utils'
import { formatBooleanInputs } from '@/utils/model-config'
import { createWorkflowCallbacks } from './workflow-callbacks'

export type UseTextGenerationProps = {
  isWorkflow: boolean
  isCallBatchAPI: boolean
  isPC: boolean
  appSourceType: AppSourceType
  appId?: string
  promptConfig: PromptConfig | null
  inputs: Record<string, InputValueTypes>
  controlSend?: number
  controlRetry?: number
  controlStopResponding?: number
  onShowRes: () => void
  taskId?: number
  onCompleted: (completionRes: string, taskId?: number, success?: boolean) => void
  visionConfig: VisionSettings
  completionFiles: VisionFile[]
  onRunStart: () => void
  onRunControlChange?: (control: { onStop: () => Promise<void> | void, isStopping: boolean } | null) => void
}

function hasUploadingFiles(files: VisionFile[]): boolean {
  return files.some(item => item.transfer_method === TransferMethod.local_file && !item.upload_file_id)
}

function processFileInputs(
  processedInputs: Record<string, string | number | boolean | object>,
  promptVariables: PromptConfig['prompt_variables'],
) {
  promptVariables.forEach((variable) => {
    const value = processedInputs[variable.key]
    if (variable.type === 'file' && value && typeof value === 'object' && !Array.isArray(value))
      processedInputs[variable.key] = getProcessedFiles([value as FileEntity])[0]
    else if (variable.type === 'file-list' && Array.isArray(value) && value.length > 0)
      processedInputs[variable.key] = getProcessedFiles(value as FileEntity[])
  })
}

function prepareVisionFiles(files: VisionFile[]): VisionFile[] {
  return files.map(item =>
    item.transfer_method === TransferMethod.local_file ? { ...item, url: '' } : item,
  )
}

export function useTextGeneration(props: UseTextGenerationProps) {
  const {
    isWorkflow,
    isCallBatchAPI,
    isPC,
    appSourceType,
    appId,
    promptConfig,
    inputs,
    controlSend,
    controlRetry,
    controlStopResponding,
    onShowRes,
    taskId,
    onCompleted,
    visionConfig,
    completionFiles,
    onRunStart,
    onRunControlChange,
  } = props

  const { notify } = Toast

  const [isResponding, { setTrue: setRespondingTrue, setFalse: setRespondingFalse }] = useBoolean(false)

  const [completionRes, doSetCompletionRes] = useState('')
  const completionResRef = useRef('')
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
  const isEndRef = useRef(false)
  const isTimeoutRef = useRef(false)
  const tempMessageIdRef = useRef('')

  const resetRunState = useCallback(() => {
    setCurrentTaskId(null) // eslint-disable-line react-hooks-extra/no-direct-set-state-in-use-effect
    setIsStopping(false) // eslint-disable-line react-hooks-extra/no-direct-set-state-in-use-effect
    abortControllerRef.current = null
    onRunControlChange?.(null)
  }, [onRunControlChange])

  const [messageId, setMessageId] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<FeedbackType>({ rating: null })
  const [controlClearMoreLikeThis, setControlClearMoreLikeThis] = useState(0)

  const handleFeedback = async (fb: FeedbackType) => {
    await updateFeedback(
      { url: `/messages/${messageId}/feedbacks`, body: { rating: fb.rating, content: fb.content } },
      appSourceType,
      appId,
    )
    setFeedback(fb)
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
      notify({ type: 'error', message: error instanceof Error ? error.message : String(error) })
    }
    finally {
      setIsStopping(false)
    }
  }, [appId, currentTaskId, appSourceType, isStopping, isWorkflow, notify])

  const checkCanSend = (): boolean => {
    if (isCallBatchAPI)
      return true

    const promptVariables = promptConfig?.prompt_variables
    if (!promptVariables?.length) {
      if (hasUploadingFiles(completionFiles)) {
        notify({ type: 'info', message: t('errorMessage.waitForFileUpload', { ns: 'appDebug' }) })
        return false
      }
      return true
    }

    let hasEmptyInput = ''
    const requiredVars = promptVariables?.filter(({ key, name, required, type }) => {
      if (type === 'boolean' || type === 'checkbox')
        return false
      return (!key || !key.trim()) || (!name || !name.trim()) || (required || required === undefined || required === null)
    }) || []

    requiredVars.forEach(({ key, name }) => {
      if (hasEmptyInput)
        return
      if (!inputs[key])
        hasEmptyInput = name
    })

    if (hasEmptyInput) {
      notify({ type: 'error', message: t('errorMessage.valueOfVarRequired', { ns: 'appDebug', key: hasEmptyInput }) })
      return false
    }

    if (hasUploadingFiles(completionFiles)) {
      notify({ type: 'info', message: t('errorMessage.waitForFileUpload', { ns: 'appDebug' }) })
      return false
    }

    return !hasEmptyInput
  }

  const handleSend = async () => {
    if (isResponding) {
      notify({ type: 'info', message: t('errorMessage.waitForResponse', { ns: 'appDebug' }) })
      return
    }

    if (!checkCanSend())
      return

    const definedInputs = Object.fromEntries(
      Object.entries(inputs).filter(([, v]) => v !== undefined),
    ) as Record<string, string | number | boolean | object>
    const processedInputs = { ...formatBooleanInputs(promptConfig?.prompt_variables, definedInputs) }
    processFileInputs(processedInputs, promptConfig?.prompt_variables ?? [])

    const data: { inputs: Record<string, string | number | boolean | object>, files?: VisionFile[] } = { inputs: processedInputs }
    if (visionConfig.enabled && completionFiles?.length > 0)
      data.files = prepareVisionFiles(completionFiles)
    setMessageId(null)
    setFeedback({ rating: null })
    setCompletionRes('')
    resetRunState()
    isEndRef.current = false
    isTimeoutRef.current = false
    tempMessageIdRef.current = ''

    if (!isPC) {
      onShowRes()
      onRunStart()
    }

    setRespondingTrue()

    ;(async () => {
      await sleep(TEXT_GENERATION_TIMEOUT_MS)
      if (!isEndRef.current) {
        setRespondingFalse()
        onCompleted(getCompletionRes(), taskId, false)
        resetRunState()
        isTimeoutRef.current = true
      }
    })()

    if (isWorkflow) {
      const callbacks = createWorkflowCallbacks({
        getProcessData: getWorkflowProcessData,
        setProcessData: setWorkflowProcessData,
        setCurrentTaskId,
        setIsStopping,
        getCompletionRes,
        setCompletionRes,
        setRespondingFalse,
        resetRunState,
        setMessageId,
        isTimeoutRef,
        isEndRef,
        tempMessageIdRef,
        taskId,
        onCompleted,
        notify,
        t,
        requestData: data,
      })
      sendWorkflowMessage(data, callbacks, appSourceType, appId).catch((error) => {
        setRespondingFalse()
        resetRunState()
        notify({ type: 'error', message: error instanceof Error ? error.message : String(error) })
      })
    }
    else {
      let res: string[] = []
      sendCompletionMessage(data, {
        onData: (chunk: string, _isFirstMessage: boolean, { messageId: msgId, taskId: tId }) => {
          tempMessageIdRef.current = msgId
          if (tId && typeof tId === 'string' && tId.trim() !== '')
            setCurrentTaskId(prev => prev ?? tId)
          res.push(chunk)
          setCompletionRes(res.join(''))
        },
        onCompleted: () => {
          if (isTimeoutRef.current) {
            notify({ type: 'warning', message: t('warningMessage.timeoutExceeded', { ns: 'appDebug' }) })
            return
          }
          setRespondingFalse()
          resetRunState()
          setMessageId(tempMessageIdRef.current)
          onCompleted(getCompletionRes(), taskId, true)
          isEndRef.current = true
        },
        onMessageReplace: (messageReplace) => {
          res = [messageReplace.answer]
          setCompletionRes(res.join(''))
        },
        onError() {
          if (isTimeoutRef.current) {
            notify({ type: 'warning', message: t('warningMessage.timeoutExceeded', { ns: 'appDebug' }) })
            return
          }
          setRespondingFalse()
          resetRunState()
          onCompleted(getCompletionRes(), taskId, false)
          isEndRef.current = true
        },
        getAbortController: (abortController) => {
          abortControllerRef.current = abortController
        },
      }, appSourceType, appId)
    }
  }

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

  useEffect(() => {
    if (!onRunControlChange)
      return
    if (isResponding && currentTaskId)
      onRunControlChange({ onStop: handleStop, isStopping })
    else
      onRunControlChange(null)
  }, [currentTaskId, handleStop, isResponding, isStopping, onRunControlChange])

  useEffect(() => {
    if (controlSend) {
      handleSend()
      setControlClearMoreLikeThis(Date.now()) // eslint-disable-line react-hooks-extra/no-direct-set-state-in-use-effect
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [controlSend])

  useEffect(() => {
    if (controlRetry)
      handleSend()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [controlRetry])

  return {
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
  }
}
