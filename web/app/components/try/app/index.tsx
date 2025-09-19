'use client'
import type { FC } from 'react'
import React from 'react'
import Chat from './chat'
import TextGeneration from './text-generation'

type Props = {
  appId: string
}

const TryApp: FC<Props> = ({
  appId,
}) => {
  // get app type by /trial-apps/<uuid:app_id>
  const isChat = appId === 'fsVnyqGJbriqnPxK'
  const isCompletion = !isChat
  return (
    <div className='flex h-full'>
      {isChat && (
        <Chat appId={appId} className='h-full grow' />
      )}
      {isCompletion && (
        <TextGeneration appId={appId} className='h-full grow' />
      )}
      <div className='w-[360px]'>
        Right panel
      </div>
    </div>
  )
}
export default React.memo(TryApp)
