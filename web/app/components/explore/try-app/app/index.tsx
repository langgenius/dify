'use client'
import type { FC } from 'react'
import React from 'react'
import Chat from './chat'
import TextGeneration from './text-generation'
import Loading from '../../../base/loading'
import { useGetTryAppInfo } from '@/service/use-try-app'
import type { AppData } from '@/models/share'
import useDocumentTitle from '@/hooks/use-document-title'

type Props = {
  appId: string
}

const TryApp: FC<Props> = ({
  appId,
}) => {
  const { isFetching: isFetchingAppInfo, data: appInfo } = useGetTryAppInfo(appId)
  const mode = appInfo?.mode
  const isChat = ['chat', 'advanced-chat', 'agent-chat'].includes(mode!)
  const isCompletion = !isChat

  useDocumentTitle(appInfo?.site?.title || '')

  if (isFetchingAppInfo) {
    return (
      <div className='flex h-full items-center justify-center'>
        <Loading type='app' />
      </div>
    )
  }
  return (
    <div className='flex h-full w-full'>
      {isChat && (
        <Chat appId={appId} className='h-full grow' />
      )}
      {isCompletion && (
        <TextGeneration
          appId={appId}
          className='h-full grow'
          isWorkflow={mode === 'workflow'}
          appData={{
            app_id: appId,
            custom_config: {},
            ...appInfo,
          } as AppData}
        />
      )}
    </div>
  )
}
export default React.memo(TryApp)
