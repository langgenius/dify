import {
  memo,
} from 'react'
import { Markdown } from '@/app/components/base/markdown'
import CodeEditor from '@/app/components/workflow/nodes/_base/components/editor/code-editor'
import { CodeLanguage } from '@/app/components/workflow/nodes/code/types'
import type { WorkflowProcess } from '@/app/components/base/chat/types'
import { FileList } from '@/app/components/base/file-uploader'

const ResultTab = ({
  data,
  content,
  currentTab,
}: {
  data?: WorkflowProcess
  content: any
  currentTab: string
}) => {
  return (
    <>
      {currentTab === 'RESULT' && (
        <div className='space-y-3 p-4'>
          {data?.resultText && <Markdown content={data?.resultText || ''} />}
          {!!data?.files?.length && (
            <div className='flex flex-col gap-2'>
              {data?.files.map((item: any) => (
                <div key={item.varName} className='system-xs-regular flex flex-col gap-1'>
                  <div className='py-1 text-text-tertiary '>{item.varName}</div>
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
        <div className='p-4'>
          <CodeEditor
            readOnly
            title={<div>JSON OUTPUT</div>}
            language={CodeLanguage.json}
            value={content}
            isJSONStringifyBeauty
          />
        </div>
      )}
    </>
  )
}

export default memo(ResultTab)
