'use client'
import type { FC } from 'react'
import CodeEditor from '@/app/components/workflow/nodes/_base/components/editor/code-editor'
import { CodeLanguage } from '@/app/components/workflow/nodes/code/types'
import { Markdown } from '@/app/components/base/markdown'
import LoadingAnim from '@/app/components/base/chat/chat/loading-anim'
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
      {outputs && Object.keys(outputs).length === 1 && (
        <div className='px-4 py-2'>
          <Markdown content={outputs[Object.keys(outputs)[0]] || ''} />
        </div>
      )}
      {outputs && Object.keys(outputs).length > 1 && height! > 0 && (
        <div className='px-4 py-2 flex flex-col gap-2'>
          <CodeEditor
            readOnly
            title={<div></div>}
            language={CodeLanguage.json}
            value={outputs}
            isJSONStringifyBeauty
            height={height}
          />
        </div>
      )}
    </div>
  )
}

export default OutputPanel
