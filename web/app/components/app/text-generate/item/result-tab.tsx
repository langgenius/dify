import type { WorkflowProcess } from '@/app/components/base/chat/types'
import { memo } from 'react'
import { OrderedResponseContent } from '@/app/components/base/chat/chat/answer/ordered-response-content'
import { ChatContextProvider } from '@/app/components/base/chat/chat/context-provider'
import { FileList } from '@/app/components/base/file-uploader'
import { Markdown } from '@/app/components/base/markdown'
import CodeEditor from '@/app/components/workflow/nodes/_base/components/editor/code-editor'
import { CodeLanguage } from '@/app/components/workflow/nodes/code/types'
import { WorkflowRunningStatus } from '@/app/components/workflow/types'
import { hasOpenUIParts } from '@/features/generative-ui/stream-reducer'

const parseContent = (content: string | object) => {
  if (typeof content !== 'string') return content
  try {
    return JSON.parse(content)
  } catch {
    return content
  }
}

const ResultTab = ({
  data,
  content,
  currentTab,
}: {
  data?: WorkflowProcess
  content: any
  currentTab: string
}) => {
  const hasUI = hasOpenUIParts(data?.parts)
  const isRunning = data?.status === WorkflowRunningStatus.Running
  return (
    <>
      {currentTab === 'RESULT' && (
        <div className="space-y-3 p-4">
          {hasUI ? (
            <ChatContextProvider chatList={[]} isResponding={isRunning} readonly>
              <OrderedResponseContent
                item={{ id: 'workflow-result', parts: data?.parts }}
                content={data?.resultText || ''}
                renderText={(text) => <Markdown content={text} />}
                allowInteractive={false}
              />
            </ChatContextProvider>
          ) : (
            data?.resultText && <Markdown content={data?.resultText || ''} />
          )}
          {!!data?.files?.length && (
            <div className="flex flex-col gap-2">
              {data?.files.map((item: any) => (
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
        </div>
      )}
      {currentTab === 'DETAIL' && content && (
        <div className="p-4">
          <CodeEditor
            readOnly
            title={<div>JSON OUTPUT</div>}
            language={CodeLanguage.json}
            value={parseContent(content)}
            isJSONStringifyBeauty
          />
        </div>
      )}
    </>
  )
}

export default memo(ResultTab)
