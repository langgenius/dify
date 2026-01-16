'use client'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'
import LoadingAnim from '@/app/components/base/chat/chat/loading-anim'
import { FileList } from '@/app/components/base/file-uploader'
import { ImageIndentLeft } from '@/app/components/base/icons/src/vender/line/editor'
import { Markdown } from '@/app/components/base/markdown'
import StatusContainer from '@/app/components/workflow/run/status-container'

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
    <div className="bg-background-section-burn">
      {isRunning && !outputs && (
        <div className="pl-[26px] pt-4">
          <LoadingAnim type="text" />
        </div>
      )}
      {!isRunning && error && (
        <div className="px-4 py-2">
          <StatusContainer status="failed">
            {error}
          </StatusContainer>
        </div>
      )}
      {!isRunning && !outputs && !error && !allFiles?.length && (
        <div className="mt-[120px] flex flex-col items-center px-4 py-2 text-[13px] leading-[18px] text-gray-500">
          <ImageIndentLeft className="h-6 w-6 text-gray-400" />
          <div className="mr-2">{t('resultEmpty.title', { ns: 'runLog' })}</div>
          <div>
            {t('resultEmpty.tipLeft', { ns: 'runLog' })}
            <span onClick={onClick} className="cursor-pointer text-primary-600">{t('resultEmpty.link', { ns: 'runLog' })}</span>
            {t('resultEmpty.tipRight', { ns: 'runLog' })}
          </div>
        </div>
      )}
      {(outputs || !!allFiles?.length) && (
        <>
          {outputs && (
            <div className="px-4 py-2">
              <Markdown content={outputs} />
            </div>
          )}
          {!!allFiles?.length && allFiles.map(item => (
            <div key={item.varName} className="system-xs-regular flex flex-col gap-1 px-4 py-2">
              <div className="py-1 text-text-tertiary ">{item.varName}</div>
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
