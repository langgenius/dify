'use client'
import type { FC } from 'react'
import { useMemo } from 'react'
import CodeEditor from '@/app/components/workflow/nodes/_base/components/editor/code-editor'
import { CodeLanguage } from '@/app/components/workflow/nodes/code/types'
import { Markdown } from '@/app/components/base/markdown'
import LoadingAnim from '@/app/components/base/chat/chat/loading-anim'
import { FileList } from '@/app/components/base/file-uploader'
import StatusContainer from '@/app/components/workflow/run/status-container'
import { getProcessedFilesFromResponse } from '@/app/components/base/file-uploader/utils'

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
    return outputs && Object.keys(outputs).length === 1 && typeof outputs[Object.keys(outputs)[0]] === 'string'
  }, [outputs])

  const fileList = useMemo(() => {
    const fileList: any[] = []
    if (!outputs)
      return fileList
    if (Object.keys(outputs).length > 1)
      return fileList
    for (const key in outputs) {
      if (Array.isArray(outputs[key])) {
        outputs[key].map((output: any) => {
          if (output?.dify_model_identity === '__dify__file__')
            fileList.push(output)
          return null
        })
      }
      else if (outputs[key]?.dify_model_identity === '__dify__file__') {
        fileList.push(outputs[key])
      }
    }
    return getProcessedFilesFromResponse(fileList)
  }, [outputs])
  return (
    <div className='py-2'>
      {isRunning && (
        <div className='pt-4 pl-[26px]'>
          <LoadingAnim type='text' />
        </div>
      )}
      {!isRunning && error && (
        <div className='px-4'>
          <StatusContainer status='failed'>{error}</StatusContainer>
        </div>
      )}
      {!isRunning && !outputs && (
        <div className='px-4 py-2'>
          <Markdown content='No Output' />
        </div>
      )}
      {isTextOutput && (
        <div className='px-4 py-2'>
          <Markdown content={outputs[Object.keys(outputs)[0]] || ''} />
        </div>
      )}
      {fileList.length > 0 && (
        <div className='px-4 py-2'>
          <FileList
            files={fileList}
            showDeleteAction={false}
            showDownloadAction
            canPreview
          />
        </div>
      )}
      {outputs && Object.keys(outputs).length > 1 && height! > 0 && (
        <div className='flex flex-col gap-2'>
          <CodeEditor
            showFileList
            readOnly
            title={<div></div>}
            language={CodeLanguage.json}
            value={outputs}
            isJSONStringifyBeauty
            height={height ? (height - 16) / 2 : undefined}
          />
        </div>
      )}
    </div>
  )
}

export default OutputPanel
