'use client'
import type { FC } from 'react'
import type {
  WorkflowRunDetailResponse,
  WorkflowRunReplayGenerationItem,
  WorkflowRunResultReplay,
} from '@/models/log'
import type { LLMGenerationItem, NodeTracing } from '@/types/workflow'
import copy from 'copy-to-clipboard'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useContext } from 'use-context-selector'
import Button from '@/app/components/base/button'
import { getFilesInLogs, getProcessedFilesFromResponse } from '@/app/components/base/file-uploader/utils'
import Loading from '@/app/components/base/loading'
import { ToastContext } from '@/app/components/base/toast'
import { WorkflowRunningStatus } from '@/app/components/workflow/types'
import { fetchRunDetail, fetchTracingList } from '@/service/log'
import { cn } from '@/utils/classnames'
import { useStore } from '../store'
import OutputPanel from './output-panel'
import ResultPanel from './result-panel'
import ResultText from './result-text'
import StatusPanel from './status'
import TracingPanel from './tracing-panel'

type GenerationToolCall = {
  name?: string
  arguments?: string
  result?: Record<string, unknown> | string
  output?: Record<string, unknown> | string
  elapsed_time?: number
  time_cost?: number
  icon?: string | { background: string, content: string }
  icon_dark?: string | { background: string, content: string }
  tool_icon?: string | { background: string, content: string }
  tool_icon_dark?: string | { background: string, content: string }
  files?: unknown[]
  tool_files?: unknown[]
  error?: string | null
  status?: string
}

type GenerationSequenceSegment = {
  type: 'content' | 'reasoning' | 'tool_call'
  start?: number
  end?: number
  index?: number
}

type GenerationPayload = {
  content?: string
  reasoning_content?: string[]
  tool_calls?: GenerationToolCall[]
  sequence?: GenerationSequenceSegment[]
}

type HistoryResultView = {
  resultText?: string
  llmGenerationItems: LLMGenerationItem[]
  allFiles: ReturnType<typeof getFilesInLogs>
  copyContent: string
}

export type RunProps = {
  hideResult?: boolean
  activeTab?: 'RESULT' | 'DETAIL' | 'TRACING'
  getResultCallback?: (result: WorkflowRunDetailResponse) => void
  runDetailUrl: string
  tracingListUrl: string
  useFirstRunResultView?: boolean
}

const stringifyCopyValue = (value: unknown) => {
  if (typeof value === 'string')
    return value

  if (value === null || typeof value === 'undefined')
    return ''

  try {
    return JSON.stringify(value, null, 2)
  }
  catch {
    return String(value)
  }
}

const buildCopyContentFromLLMGenerationItems = (llmGenerationItems?: LLMGenerationItem[]) => {
  if (!llmGenerationItems?.length)
    return ''

  const hasStructuredItems = llmGenerationItems.some(item => item.type !== 'text')
  if (!hasStructuredItems)
    return ''

  return llmGenerationItems
    .map((item) => {
      if (item.type === 'text')
        return item.text || ''

      if (item.type === 'thought')
        return item.thoughtOutput ? `[THOUGHT]\n${item.thoughtOutput}` : ''

      if (item.type === 'tool') {
        const sections = [
          `[TOOL] ${item.toolName || ''}`.trim(),
        ]

        if (item.toolArguments)
          sections.push(`INPUT:\n${stringifyCopyValue(item.toolArguments)}`)
        if (typeof item.toolOutput !== 'undefined')
          sections.push(`OUTPUT:\n${stringifyCopyValue(item.toolOutput)}`)
        if (item.toolError)
          sections.push(`ERROR:\n${item.toolError}`)

        return sections.join('\n')
      }

      return ''
    })
    .filter(Boolean)
    .join('\n\n')
}

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

const getSingleStringOutput = (outputs?: WorkflowRunDetailResponse['outputs']) => {
  if (!isRecord(outputs))
    return undefined

  const entries = Object.entries(outputs)
  if (entries.length !== 1)
    return undefined

  const [, value] = entries[0]
  return typeof value === 'string' ? value : undefined
}

const getSingleGenerationOutput = (outputs?: WorkflowRunDetailResponse['outputs']) => {
  if (!isRecord(outputs))
    return undefined

  const values = Object.values(outputs)
  if (values.length !== 1)
    return undefined

  const [value] = values
  if (!isRecord(value))
    return undefined

  return value as GenerationPayload
}

const buildGenerationItemsFromPayload = (generation?: GenerationPayload): {
  resultText?: string
  llmGenerationItems: LLMGenerationItem[]
} => {
  if (!generation)
    return { resultText: undefined, llmGenerationItems: [] }

  const resultText = typeof generation.content === 'string' ? generation.content : undefined
  const reasoningContent = Array.isArray(generation.reasoning_content) ? generation.reasoning_content : []
  const toolCalls = Array.isArray(generation.tool_calls) ? generation.tool_calls : []
  const sequence = Array.isArray(generation.sequence) ? generation.sequence : []
  const llmGenerationItems: LLMGenerationItem[] = []
  const appendSyntheticToolItem = (toolCall: GenerationToolCall, index: number) => {
    const toolOutput = typeof toolCall.result !== 'undefined' ? toolCall.result : toolCall.output

    llmGenerationItems.push({
      id: `generation-tool-${index}`,
      type: 'tool',
      toolName: toolCall.name,
      toolArguments: toolCall.arguments,
      toolOutput,
      toolDuration: toolCall.elapsed_time ?? toolCall.time_cost,
      toolIcon: toolCall.icon ?? toolCall.tool_icon,
      toolIconDark: toolCall.icon_dark ?? toolCall.tool_icon_dark,
      toolFiles: Array.isArray(toolCall.files) ? toolCall.files : toolCall.tool_files,
      toolError: toolCall.status === 'error'
        ? (toolCall.error || stringifyCopyValue(toolOutput) || 'error')
        : undefined,
    })
  }

  sequence.forEach((segment, index) => {
    if (segment.type === 'content') {
      const start = typeof segment.start === 'number' ? segment.start : 0
      const end = typeof segment.end === 'number' ? segment.end : start
      const text = resultText?.substring(start, end)
      if (text?.trim()) {
        llmGenerationItems.push({
          id: `generation-text-${index}`,
          type: 'text',
          text,
          textCompleted: true,
        })
      }
      return
    }

    if (segment.type === 'reasoning') {
      const reasoning = typeof segment.index === 'number' ? reasoningContent[segment.index] : undefined
      if (reasoning) {
        llmGenerationItems.push({
          id: `generation-thought-${index}`,
          type: 'thought',
          thoughtOutput: reasoning,
          thoughtCompleted: true,
        })
      }
      return
    }

    if (segment.type === 'tool_call') {
      const toolCall = typeof segment.index === 'number' ? toolCalls[segment.index] : undefined
      if (!toolCall)
        return

      appendSyntheticToolItem(toolCall, index)
    }
  })

  if (!llmGenerationItems.length && (reasoningContent.length || toolCalls.length || resultText)) {
    const syntheticSegmentCount = Math.max(reasoningContent.length, toolCalls.length)

    for (let i = 0; i < syntheticSegmentCount; i += 1) {
      const reasoning = reasoningContent[i]
      if (reasoning) {
        llmGenerationItems.push({
          id: `generation-thought-${i}`,
          type: 'thought',
          thoughtOutput: reasoning,
          thoughtCompleted: true,
        })
      }

      const toolCall = toolCalls[i]
      if (toolCall)
        appendSyntheticToolItem(toolCall, i)
    }

    if (resultText) {
      llmGenerationItems.push({
        id: 'generation-text-final',
        type: 'text',
        text: resultText,
        textCompleted: true,
      })
    }
  }

  return {
    resultText,
    llmGenerationItems,
  }
}

const buildGenerationItemsFromReplay = (items?: WorkflowRunReplayGenerationItem[]) => {
  if (!items?.length)
    return []

  return items
    .filter((item) => {
      if (item.type === 'thought')
        return !!item.thought_output

      if (item.type === 'tool')
        return !!(item.tool_name || item.tool_arguments || item.tool_output || item.tool_error || item.tool_files?.length)

      if (item.type === 'text')
        return typeof item.text === 'string' && item.text.length > 0

      return true
    })
    .map((item, index) => ({
      id: `replay-item-${index}`,
      type: item.type,
      text: item.text,
      textCompleted: item.text_completed,
      thoughtOutput: item.thought_output,
      thoughtCompleted: item.thought_completed,
      toolName: item.tool_name,
      toolArguments: item.tool_arguments,
      toolOutput: item.tool_output,
      toolFiles: item.tool_files,
      toolError: item.tool_error,
      toolDuration: item.tool_duration,
      toolIcon: item.tool_icon,
      toolIconDark: item.tool_icon_dark,
    } satisfies LLMGenerationItem))
}

const buildAllFilesFromReplay = (resultReplay?: WorkflowRunResultReplay | null) => {
  if (!resultReplay?.files?.length)
    return []

  return resultReplay.files
    .map(fileGroup => ({
      varName: fileGroup.var_name,
      list: getProcessedFilesFromResponse(fileGroup.files || []),
    }))
    .filter(fileGroup => fileGroup.list.length > 0)
}

const buildHistoryResultView = (runDetail?: WorkflowRunDetailResponse): HistoryResultView => {
  if (!runDetail) {
    return {
      resultText: undefined,
      llmGenerationItems: [],
      allFiles: [],
      copyContent: '',
    }
  }

  if (runDetail.result_replay) {
    const llmGenerationItems = buildGenerationItemsFromReplay(runDetail.result_replay.llm_generation_items)
    const resultText = runDetail.result_replay.text
    const copyContent = buildCopyContentFromLLMGenerationItems(llmGenerationItems) || resultText || ''

    return {
      resultText,
      llmGenerationItems,
      allFiles: buildAllFilesFromReplay(runDetail.result_replay),
      copyContent,
    }
  }

  const allFiles = isRecord(runDetail.outputs) ? getFilesInLogs(runDetail.outputs) : []

  const singleTextOutput = getSingleStringOutput(runDetail.outputs)
  if (singleTextOutput) {
    return {
      resultText: singleTextOutput,
      llmGenerationItems: [],
      allFiles,
      copyContent: singleTextOutput,
    }
  }

  if (runDetail.outputs_as_generation) {
    const generationPayload = getSingleGenerationOutput(runDetail.outputs)
    const { resultText, llmGenerationItems } = buildGenerationItemsFromPayload(generationPayload)
    return {
      resultText,
      llmGenerationItems,
      allFiles,
      copyContent: buildCopyContentFromLLMGenerationItems(llmGenerationItems) || resultText || '',
    }
  }

  return {
    resultText: undefined,
    llmGenerationItems: [],
    allFiles,
    copyContent: '',
  }
}

const RunPanel: FC<RunProps> = ({
  hideResult,
  activeTab = 'RESULT',
  getResultCallback,
  runDetailUrl,
  tracingListUrl,
  useFirstRunResultView = false,
}) => {
  const { t } = useTranslation()
  const { notify } = useContext(ToastContext)
  const [currentTab, setCurrentTab] = useState<string>(activeTab)
  const [loading, setLoading] = useState<boolean>(true)
  const [runDetail, setRunDetail] = useState<WorkflowRunDetailResponse>()
  const [list, setList] = useState<NodeTracing[]>([])
  const isListening = useStore(s => s.isListening)

  const executor = useMemo(() => {
    if (runDetail?.created_by_role === 'account')
      return runDetail.created_by_account?.name || ''
    if (runDetail?.created_by_role === 'end_user')
      return runDetail.created_by_end_user?.session_id || ''
    return 'N/A'
  }, [runDetail])

  const historyResultView = useMemo(
    () => buildHistoryResultView(runDetail),
    [runDetail],
  )

  const getResult = useCallback(async () => {
    try {
      const res = await fetchRunDetail(runDetailUrl)
      setRunDetail(res)
      if (getResultCallback)
        getResultCallback(res)
    }
    catch (err) {
      notify({
        type: 'error',
        message: `${err}`,
      })
    }
  }, [notify, getResultCallback, runDetailUrl])

  const getTracingList = useCallback(async () => {
    try {
      const { data: nodeList } = await fetchTracingList({
        url: tracingListUrl,
      })
      setList(nodeList)
    }
    catch (err) {
      notify({
        type: 'error',
        message: `${err}`,
      })
    }
  }, [notify, tracingListUrl])

  const getData = useCallback(async () => {
    setLoading(true)
    await getResult()
    await getTracingList()
    setLoading(false)
  }, [getResult, getTracingList])

  const switchTab = async (tab: string) => {
    setCurrentTab(tab)
    if (tab === 'RESULT') {
      if (runDetailUrl)
        await getResult()
    }
    if (tracingListUrl)
      await getTracingList()
  }

  useEffect(() => {
    if (isListening)
      setCurrentTab('DETAIL')
  }, [isListening])

  useEffect(() => {
    if (runDetailUrl && tracingListUrl)
      getData()
  }, [getData, runDetailUrl, tracingListUrl])

  const [height, setHeight] = useState(0)
  const ref = useRef<HTMLDivElement>(null)

  const adjustResultHeight = () => {
    if (ref.current)
      setHeight(ref.current?.clientHeight - 16 - 16 - 2 - 1)
  }

  useEffect(() => {
    adjustResultHeight()
  }, [loading])

  return (
    <div className="relative flex grow flex-col">
      <div className="flex shrink-0 items-center border-b-[0.5px] border-divider-subtle px-4">
        {!hideResult && (
          <div
            className={cn(
              'mr-6 cursor-pointer border-b-2 border-transparent py-3 text-text-tertiary system-sm-semibold-uppercase',
              currentTab === 'RESULT' && '!border-util-colors-blue-brand-blue-brand-600 text-text-primary',
            )}
            onClick={() => switchTab('RESULT')}
          >
            {t('result', { ns: 'runLog' })}
          </div>
        )}
        <div
          className={cn(
            'mr-6 cursor-pointer border-b-2 border-transparent py-3 text-text-tertiary system-sm-semibold-uppercase',
            currentTab === 'DETAIL' && '!border-util-colors-blue-brand-blue-brand-600 text-text-primary',
          )}
          onClick={() => switchTab('DETAIL')}
        >
          {t('detail', { ns: 'runLog' })}
        </div>
        <div
          className={cn(
            'mr-6 cursor-pointer border-b-2 border-transparent py-3 text-text-tertiary system-sm-semibold-uppercase',
            currentTab === 'TRACING' && '!border-util-colors-blue-brand-blue-brand-600 text-text-primary',
          )}
          onClick={() => switchTab('TRACING')}
        >
          {t('tracing', { ns: 'runLog' })}
        </div>
      </div>
      <div
        ref={ref}
        className={cn(
          'relative h-0 grow overflow-y-auto rounded-b-xl bg-background-section',
          useFirstRunResultView && (currentTab === 'RESULT' || currentTab === 'TRACING') && '!bg-background-section-burn',
        )}
      >
        {loading && (
          <div className="flex h-full items-center justify-center bg-components-panel-bg">
            <Loading />
          </div>
        )}
        {!loading && currentTab === 'RESULT' && runDetail && !useFirstRunResultView && (
          <OutputPanel
            outputs={runDetail.outputs}
            error={runDetail.error}
            height={height}
          />
        )}
        {!loading && currentTab === 'RESULT' && runDetail && useFirstRunResultView && (
          <div className="p-2">
            <ResultText
              isRunning={runDetail.status === WorkflowRunningStatus.Running}
              outputs={historyResultView.resultText}
              llmGenerationItems={historyResultView.llmGenerationItems}
              allFiles={historyResultView.allFiles}
              error={runDetail.error}
              onClick={() => { void switchTab('DETAIL') }}
            />
            {runDetail.status !== WorkflowRunningStatus.Running && historyResultView.copyContent && (
              <Button
                className={cn('mb-4 ml-4 space-x-1')}
                onClick={() => {
                  copy(historyResultView.copyContent)
                  notify({
                    type: 'success',
                    message: t('actionMsg.copySuccessfully', { ns: 'common' }),
                  })
                }}
              >
                <span className="i-ri-clipboard-line h-3.5 w-3.5" />
                <div>{t('operation.copy', { ns: 'common' })}</div>
              </Button>
            )}
          </div>
        )}
        {!loading && currentTab === 'DETAIL' && runDetail && (
          <ResultPanel
            inputs={runDetail.inputs}
            inputs_truncated={runDetail.inputs_truncated}
            outputs={runDetail.outputs}
            outputs_truncated={runDetail.outputs_truncated}
            outputs_full_content={runDetail.outputs_full_content}
            status={runDetail.status}
            error={runDetail.error}
            elapsed_time={runDetail.elapsed_time}
            total_tokens={runDetail.total_tokens}
            created_at={runDetail.created_at}
            created_by={executor}
            steps={runDetail.total_steps}
            exceptionCounts={runDetail.exceptions_count}
            isListening={isListening}
            workflowRunId={runDetail.id}
          />
        )}
        {!loading && currentTab === 'DETAIL' && !runDetail && isListening && (
          <StatusPanel
            status={WorkflowRunningStatus.Running}
            isListening={true}
          />
        )}
        {!loading && currentTab === 'TRACING' && (
          <TracingPanel
            className={useFirstRunResultView ? 'bg-background-section-burn' : 'bg-background-section'}
            list={list}
          />
        )}
      </div>
    </div>
  )
}

export default RunPanel
