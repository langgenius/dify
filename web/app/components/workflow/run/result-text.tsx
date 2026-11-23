'use client'
import type { FC } from 'react'
import type { MessageContentPart } from '@/features/generative-ui/protocol/types'
import { useTranslation } from 'react-i18next'
import { OrderedResponseContent } from '@/app/components/base/chat/chat/answer/ordered-response-content'
import { ChatContextProvider } from '@/app/components/base/chat/chat/context-provider'
import LoadingAnim from '@/app/components/base/chat/chat/loading-anim'
import { FileList } from '@/app/components/base/file-uploader'
import { Markdown } from '@/app/components/base/markdown'
import StatusContainer from '@/app/components/workflow/run/status-container'
import { hasOpenUIParts } from '@/features/generative-ui/stream-reducer'

type ResultTextProps = {
  isRunning?: boolean
  isPaused?: boolean
  outputs?: any
  parts?: MessageContentPart[]
  runId?: string
  error?: string
  onClick?: () => void
  allFiles?: any[]
}

const ResultText: FC<ResultTextProps> = ({
  isRunning,
  isPaused,
  outputs,
  parts,
  runId,
  error,
  onClick,
  allFiles,
}) => {
  const { t } = useTranslation(['runLog'])
  const hasUI = hasOpenUIParts(parts)
  const hasContent = Boolean(outputs || hasUI)
  return (
    <div className="bg-background-section-burn">
      {isRunning && !hasContent && (
        <div className="ps-6.5 pt-4">
          <LoadingAnim type="text" />
        </div>
      )}
      {!isRunning && error && (
        <div className="px-4 py-2">
          <StatusContainer status="failed">{error}</StatusContainer>
        </div>
      )}
      {!isPaused && !isRunning && !hasContent && !error && !allFiles?.length && (
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
      {(hasContent || !!allFiles?.length) && (
        <>
          {hasContent && (
            <div className="px-4 py-2">
              {/* ThinkBlock's timer reads isResponding from ChatContext, which the run panel otherwise lacks. */}
              <ChatContextProvider chatList={[]} isResponding={!!isRunning} readonly>
                {hasUI ? (
                  <OrderedResponseContent
                    item={{ id: runId || 'workflow-result', parts }}
                    content={typeof outputs === 'string' ? outputs : ''}
                    renderText={(text) => <Markdown content={text} />}
                    allowInteractive={false}
                  />
                ) : (
                  <Markdown content={outputs} />
                )}
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
