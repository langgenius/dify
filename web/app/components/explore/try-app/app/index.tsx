'use client'
import type { FC } from 'react'
import React from 'react'
import Chat from './chat'
import TextGeneration from './text-generation'
import type { AppData } from '@/models/share'
import useDocumentTitle from '@/hooks/use-document-title'
import type { TryAppInfo } from '@/service/try-app'

type Props = {
  appId: string
  appDetail: TryAppInfo
}

const TryApp: FC<Props> = ({
  appId,
  appDetail,
}) => {
  const mode = appDetail?.mode
  const isChat = ['chat', 'advanced-chat', 'agent-chat'].includes(mode!)
  const isCompletion = !isChat

  useDocumentTitle(appDetail?.site?.title || '')
  return (
    <div className='flex h-full w-full'>
      {isChat && (
        <Chat appId={appId} appDetail={appDetail} className='h-full grow' />
      )}
      {isCompletion && (
        <TextGeneration
          appId={appId}
          className='h-full grow'
          isWorkflow={mode === 'workflow'}
          appData={{
            app_id: appId,
            custom_config: {},
            ...appDetail,
          } as AppData}
        />
      )}
    </div>
  )
}
export default React.memo(TryApp)
