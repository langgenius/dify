'use client'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'
import { ChatContextProvider } from '@/app/components/base/chat/chat/context-provider'
import LoadingAnim from '@/app/components/base/chat/chat/loading-anim'
import { FileList } from '@/app/components/base/file-uploader'
import { Markdown } from '@/app/components/base/markdown'
import StatusContainer from '@/app/components/workflow/run/status-container'

type ResultTextProps = {
  isRunning?: boolean
  isPaused?: boolean
  isExternalWaiting?: boolean
  outputs?: any
  error?: string
  onClick?: () => void
  allFiles?: any[]
}

const ResultText: FC<ResultTextProps> = ({
  isRunning,
  isPaused,
  isExternalWaiting,
  outputs,
  error,
  onClick,
  allFiles,
}) => {
  const { t } = useTranslation(['runLog', 'agentRoster'])
  return (
    <div className="bg-background-section-burn">
      {isExternalWaiting && (
        <p role="status" className="px-4 py-3 system-sm-regular text-text-tertiary">
          {t(($) => $['external.workflow.waiting'], { ns: 'agentRoster' })}
        </p>
      )}
      {isRunning && !outputs && (
        <div className="ps-6.5 pt-4">
          <LoadingAnim type="text" />
        </div>
      )}
      {!isRunning && error && (
        <div className="px-4 py-2">
          <StatusContainer status="failed">{error}</StatusContainer>
        </div>
      )}
      {!isPaused && !isExternalWaiting && !isRunning && !outputs && !error && !allFiles?.length && (
        <div className="mt-30 flex flex-col items-center px-4 py-2 text-[13px] leading-4.5 text-gray-500">
          <span
            aria-hidden
            className="i-custom-vender-line-editor-image-indent-left size-6 text-gray-400"
          />
          <div className="me-2">{t(($) => $['resultEmpty.title'], { ns: 'runLog' })}</div>
          <div>
            {t(($) => $['resultEmpty.tipLeft'], { ns: 'runLog' })}
            <button
              type="button"
              onClick={onClick}
              className="inline cursor-pointer border-none bg-transparent p-0 text-start text-primary-600"
            >
              {t(($) => $['resultEmpty.link'], { ns: 'runLog' })}
            </button>
            {t(($) => $['resultEmpty.tipRight'], { ns: 'runLog' })}
          </div>
        </div>
      )}
      {(outputs || !!allFiles?.length) && (
        <>
          {outputs && (
            <div className="px-4 py-2">
              {/* ThinkBlock's timer reads isResponding from ChatContext, which the run panel otherwise lacks. */}
              <ChatContextProvider chatList={[]} isResponding={!!isRunning}>
                <Markdown content={outputs} />
              </ChatContextProvider>
            </div>
          )}
          {!!allFiles?.length &&
            allFiles.map((item) => (
              <div key={item.varName} className="flex flex-col gap-1 px-4 py-2 system-xs-regular">
                <div className="py-1 text-text-tertiary">{item.varName}</div>
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
