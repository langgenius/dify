'use client'
import type { AppData } from '@/models/share'
import type { TryAppInfo } from '@/service/try-app'
import { memo } from 'react'
import { FileUploadContext } from '@/app/components/base/file-uploader/upload-context'
import useDocumentTitle from '@/hooks/use-document-title'
import Chat from './chat'
import TextGeneration from './text-generation'

type Props = Readonly<{
  appId: string
  appDetail: TryAppInfo
}>

function TryApp({ appId, appDetail }: Props) {
  const mode = appDetail?.mode
  const isChat = ['chat', 'advanced-chat', 'agent-chat'].includes(mode!)
  const isCompletion = !isChat

  useDocumentTitle(appDetail?.site?.title || '')
  return (
    <FileUploadContext
      value={{
        localUploadUrl: `/trial-apps/${appId}/files/upload`,
        remoteUploadUrl: `/trial-apps/${appId}/remote-files/upload`,
      }}
    >
      <div className="flex size-full">
        {isChat && <Chat appId={appId} appDetail={appDetail} className="h-full grow" />}
        {isCompletion && (
          <TextGeneration
            appId={appId}
            className="h-full grow"
            isWorkflow={mode === 'workflow'}
            appData={
              {
                app_id: appId,
                custom_config: {},
                ...appDetail,
              } as AppData
            }
          />
        )}
      </div>
    </FileUploadContext>
  )
}
export default memo(TryApp)
