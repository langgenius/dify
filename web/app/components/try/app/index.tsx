'use client'
import type { FC } from 'react'
import React from 'react'
import Chat from './chat'

type Props = {
  appId: string
}

const TryApp: FC<Props> = ({
  appId,
}) => {
  const isChat = true
  const isCompletion = !isChat
  return (
    <div className='flex h-full'>
      {isChat && (
        <Chat appId={appId} className='h-full grow' />
      )}
      {isCompletion && (
        <div>Completion</div>
      )}
      <div className='w-[360px]'>
        Right panel
      </div>
    </div>
  )
}
export default React.memo(TryApp)
