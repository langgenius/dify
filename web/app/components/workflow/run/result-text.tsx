'use client'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'
import { ImageIndentLeft } from '@/app/components/base/icons/src/vender/line/editor'
import { Markdown } from '@/app/components/base/markdown'
import LoadingAnim from '@/app/components/base/chat/chat/loading-anim'
import StatusContainer from '@/app/components/workflow/run/status-container'
import { FileList } from '@/app/components/base/file-uploader'

type ResultTextProps = {
  isRunning?: boolean
  outputs?: any
  error?: string
  onClick?: () => void
  allFiles?: any[]
}

const ResultText: FC<ResultTextProps> = ({
  isRunning,
  outputs,
  error,
  onClick,
  allFiles,
}) => {
  const { t } = useTranslation()
  return (
    <div className='bg-background-section-burn'>
      {isRunning && !outputs && (
        <div className='pt-4 pl-[26px]'>
          <LoadingAnim type='text' />
        </div>
      )}
      {!isRunning && error && (
        <div className='px-4 py-2'>
          <StatusContainer status='failed'>
            {error}
          </StatusContainer>
        </div>
      )}
      {!isRunning && !outputs && !error && !allFiles?.length && (
        <div className='mt-[120px] px-4 py-2 flex flex-col items-center text-[13px] leading-[18px] text-gray-500'>
          <ImageIndentLeft className='w-6 h-6 text-gray-400' />
          <div className='mr-2'>{t('runLog.resultEmpty.title')}</div>
          <div>
            {t('runLog.resultEmpty.tipLeft')}
            <span onClick={onClick} className='cursor-pointer text-primary-600'>{t('runLog.resultEmpty.link')}</span>
            {t('runLog.resultEmpty.tipRight')}
          </div>
        </div>
      )}
      {(outputs || !!allFiles?.length) && (
        <>
          {outputs && (
            <div className='px-4 py-2'>
              <Markdown content={outputs} />
            </div>
          )}
          {!!allFiles?.length && allFiles.map(item => (
            <div key={item.varName} className='px-4 py-2 flex flex-col gap-1 system-xs-regular'>
              <div className='py-1 text-text-tertiary '>{item.varName}</div>
              <FileList
                files={item.list}
                showDeleteAction={false}
                showDownloadAction
                canPreview
              />
            </div>
          ))}
        </>
      )}
    </div>
  )
}

export default ResultText
