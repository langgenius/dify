'use client'
import type { FC } from 'react'
import { useMemo } from 'react'
import LoadingAnim from '@/app/components/base/chat/chat/loading-anim'
import { FileList } from '@/app/components/base/file-uploader'
import { getFilesInLogs } from '@/app/components/base/file-uploader/utils'
import { Markdown } from '@/app/components/base/markdown'
import CodeEditor from '@/app/components/workflow/nodes/_base/components/editor/code-editor'
import { CodeLanguage } from '@/app/components/workflow/nodes/code/types'
import StatusContainer from '@/app/components/workflow/run/status-container'

type OutputPanelProps = {
  isRunning?: boolean
  outputs?: any
  error?: string
  height?: number
}

const OutputPanel: FC<OutputPanelProps> = ({
  isRunning,
  outputs,
  error,
  height,
}) => {
  const isTextOutput = useMemo(() => {
    if (!outputs || typeof outputs !== 'object')
      return false
    const keys = Object.keys(outputs)
    const value = outputs[keys[0]]
    return keys.length === 1 && (
      typeof value === 'string'
      || (Array.isArray(value) && value.every(item => typeof item === 'string'))
    )
  }, [outputs])

  const fileList = useMemo(() => {
    if (!outputs)
      return []
    return getFilesInLogs(outputs)
  }, [outputs])

  const isFileOnlyOutput = useMemo(() => {
    if (!outputs || typeof outputs !== 'object')
      return false
    return fileList.length > 0 && Object.keys(outputs).every((key) => {
      const val = outputs[key]
      if (Array.isArray(val))
        return val.every((item: any) => item?.dify_model_identity === '__dify__file__')
      return val?.dify_model_identity === '__dify__file__'
    })
  }, [outputs, fileList])

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
      {isTextOutput && (
        <div className="px-4 py-2">
          <Markdown
            content={
              Array.isArray(outputs[Object.keys(outputs)[0]])
                ? outputs[Object.keys(outputs)[0]].join('\n')
                : (outputs[Object.keys(outputs)[0]] || '')
            }
          />
        </div>
      )}
      {fileList.length > 0 && (
        <div className="flex flex-col gap-2 px-4 py-2">
          {fileList.map((item: any) => (
            <div key={item.varName} className="flex flex-col gap-1 system-xs-regular">
              <div className="py-1 text-text-tertiary">{item.varName}</div>
              <FileList
                files={item.list}
                showDeleteAction={false}
                showDownloadAction
                canPreview
              />
            </div>
          ))}
        </div>
      )}
      {!isTextOutput && !isFileOnlyOutput && outputs && Object.keys(outputs).length > 0 && height! > 0 && (
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
