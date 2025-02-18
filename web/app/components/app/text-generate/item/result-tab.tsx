import {
  memo,
  useEffect,
} from 'react'
import { useTranslation } from 'react-i18next'
import cn from '@/utils/classnames'
import { Markdown } from '@/app/components/base/markdown'
import CodeEditor from '@/app/components/workflow/nodes/_base/components/editor/code-editor'
import { CodeLanguage } from '@/app/components/workflow/nodes/code/types'
import type { WorkflowProcess } from '@/app/components/base/chat/types'
import { FileList } from '@/app/components/base/file-uploader'

const ResultTab = ({
  data,
  content,
  currentTab,
  onCurrentTabChange,
}: {
  data?: WorkflowProcess
  content: any
  currentTab: string
  onCurrentTabChange: (tab: string) => void
}) => {
  const { t } = useTranslation()

  const switchTab = async (tab: string) => {
    onCurrentTabChange(tab)
  }
  useEffect(() => {
    if (data?.resultText || !!data?.files?.length)
      switchTab('RESULT')
    else
      switchTab('DETAIL')
  }, [data?.files?.length, data?.resultText])

  return (
    <div className='relative flex grow flex-col'>
      {(data?.resultText || !!data?.files?.length) && (
        <div className='mb-2 flex shrink-0 items-center border-b-[0.5px] border-[rgba(0,0,0,0.05)]'>
          <div
            className={cn(
              'mr-6 cursor-pointer border-b-2 border-transparent py-3 text-[13px] font-semibold leading-[18px] text-gray-400',
              currentTab === 'RESULT' && '!border-[rgb(21,94,239)] text-gray-700',
            )}
            onClick={() => switchTab('RESULT')}
          >{t('runLog.result')}</div>
          <div
            className={cn(
              'mr-6 cursor-pointer border-b-2 border-transparent py-3 text-[13px] font-semibold leading-[18px] text-gray-400',
              currentTab === 'DETAIL' && '!border-[rgb(21,94,239)] text-gray-700',
            )}
            onClick={() => switchTab('DETAIL')}
          >{t('runLog.detail')}</div>
        </div>
      )}
      <div className={cn('grow bg-white')}>
        {currentTab === 'RESULT' && (
          <>
            {data?.resultText && <Markdown content={data?.resultText || ''} />}
            {!!data?.files?.length && (
              <div className='flex flex-col gap-2'>
                {data?.files.map((item: any) => (
                  <div key={item.varName} className='system-xs-regular flex flex-col gap-1'>
                    <div className='text-text-tertiary py-1 '>{item.varName}</div>
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
          </>
        )}
        {currentTab === 'DETAIL' && content && (
          <div className='mt-1'>
            <CodeEditor
              readOnly
              title={<div>JSON OUTPUT</div>}
              language={CodeLanguage.json}
              value={content}
              isJSONStringifyBeauty
            />
          </div>
        )}
      </div>
    </div>
  )
}

export default memo(ResultTab)
