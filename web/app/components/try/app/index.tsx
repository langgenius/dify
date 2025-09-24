'use client'
import type { FC } from 'react'
import React from 'react'
import Chat from './chat'
import TextGeneration from './text-generation'
import Loading from '../../base/loading'
import { useGetTryAppInfo } from '@/service/use-try-app'
import type { AppData } from '@/models/share'

type Props = {
  appId: string
}

const TryApp: FC<Props> = ({
  appId,
}) => {
  const { isFetching: isFetchingAppInfo, data: appInfo } = useGetTryAppInfo(appId)
  const mode = appInfo?.mode
  const isChat = mode === 'chat'
  const isCompletion = !isChat
  if (isFetchingAppInfo) {
    return (
      <div className='flex h-full items-center justify-center'>
        <Loading type='app' />
      </div>
    )
  }
  console.log(appInfo)
  return (
    <div className='flex h-full'>
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
      <div className='w-[360px]'>
        Right panel
      </div>
    </div>
  )
}
export default React.memo(TryApp)
