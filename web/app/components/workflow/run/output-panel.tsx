'use client'
import type { FC } from 'react'
import type { JsonValue } from '@/app/components/workflow/types'
import type { FileResponse, WorkflowGenerationValue } from '@/types/workflow'
import { useMemo } from 'react'
import GenerationContent from '@/app/components/base/chat/chat/answer/generation-content'
import LoadingAnim from '@/app/components/base/chat/chat/loading-anim'
import { buildLLMGenerationItemsFromWorkflowOutputs } from '@/app/components/base/chat/utils'
import { FileList } from '@/app/components/base/file-uploader'
import { getProcessedFilesFromResponse } from '@/app/components/base/file-uploader/utils'
import { Markdown } from '@/app/components/base/markdown'
import CodeEditor from '@/app/components/workflow/nodes/_base/components/editor/code-editor'
import { CodeLanguage } from '@/app/components/workflow/nodes/code/types'
import StatusContainer from '@/app/components/workflow/run/status-container'

const isDifyFile = (val: JsonValue): val is JsonValue & { dify_model_identity: '__dify__file__' } =>
  typeof val === 'object' && val !== null && !Array.isArray(val) && 'dify_model_identity' in val && val.dify_model_identity === '__dify__file__'

type OutputPanelProps = {
  isRunning?: boolean
  outputs?: Record<string, JsonValue>
  outputsAsGeneration?: boolean
  error?: string
  height?: number
}

const OutputPanel: FC<OutputPanelProps> = ({
  isRunning,
  outputs,
  outputsAsGeneration,
  error,
  height,
}) => {
  const generationResult = useMemo(() => {
    if (!outputsAsGeneration || !outputs || typeof outputs !== 'object')
      return null
    try {
      return buildLLMGenerationItemsFromWorkflowOutputs(outputs as Record<string, WorkflowGenerationValue>)
    }
    catch {
      return null
    }
  }, [outputs, outputsAsGeneration])

  const isTextOutput = useMemo(() => {
    if (generationResult)
      return false
    if (!outputs || typeof outputs !== 'object')
      return false
    const keys = Object.keys(outputs)
    const value = outputs[keys[0]]
    return keys.length === 1 && (
      typeof value === 'string'
      || (Array.isArray(value) && value.every(item => typeof item === 'string'))
    )
  }, [outputs, generationResult])

  const fileList = useMemo(() => {
    if (!outputs || Object.keys(outputs).length > 1)
      return []
    const matched: FileResponse[] = []
    for (const key in outputs) {
      const val = outputs[key]
      if (Array.isArray(val)) {
        for (const item of val) {
          if (isDifyFile(item))
            matched.push(item as unknown as FileResponse)
        }
      }
      else if (isDifyFile(val)) {
        matched.push(val as unknown as FileResponse)
      }
    }
    return getProcessedFilesFromResponse(matched)
  }, [outputs])

  const hasGenerationToolOrThought = generationResult?.llmGenerationItems.some(
    item => item.type === 'tool' || item.type === 'thought',
  )

  const textOutputContent = useMemo(() => {
    if (!isTextOutput || !outputs)
      return ''
    const firstVal = outputs[Object.keys(outputs)[0]]
    return Array.isArray(firstVal) ? firstVal.join('\n') : String(firstVal ?? '')
  }, [isTextOutput, outputs])

  return (
    <div className="p-2">
      {isRunning && (
        <div className="pl-[26px] pt-4">
          <LoadingAnim type="text" />
        </div>
      )}
      {!isRunning && error && (
        <div className="px-4">
          <StatusContainer status="failed">{error}</StatusContainer>
        </div>
      )}
      {!isRunning && !outputs && (
        <div className="px-4 py-2">
          <Markdown content="No Output" />
        </div>
      )}
      {generationResult && generationResult.llmGenerationItems.length > 0 && (
        hasGenerationToolOrThought
          ? (
              <div className="px-2 py-1">
                <GenerationContent llmGenerationItems={generationResult.llmGenerationItems} />
              </div>
            )
          : (
              <div className="px-4 py-2">
                <Markdown content={generationResult.message} />
              </div>
            )
      )}
      {isTextOutput && (
        <div className="px-4 py-2">
          <Markdown content={textOutputContent} />
        </div>
      )}
      {fileList.length > 0 && (
        <div className="px-4 py-2">
          <FileList
            files={fileList}
            showDeleteAction={false}
            showDownloadAction
            canPreview
          />
        </div>
      )}
      {!isTextOutput && !generationResult && outputs && Object.keys(outputs).length > 0 && height! > 0 && (
        <div className="flex flex-col gap-2">
          <CodeEditor
            showFileList
            readOnly
            title={<div tabIndex={0}>Output</div>}
            language={CodeLanguage.json}
            value={JSON.stringify(outputs, null, 2)}
            isJSONStringifyBeauty
            height={height ? (height - 16) / 2 : undefined}
          />
        </div>
      )}
    </div>
  )
}

export default OutputPanel
