'use client'
import type { FC } from 'react'
import React from 'react'
import BasicAppPreview from './basic-app-preview'
import FlowAppPreview from './flow-app-preview'
import type { TryAppInfo } from '@/service/try-app'

type Props = {
  appId: string
  appDetail: TryAppInfo
}

const Preview: FC<Props> = ({
  appId,
  appDetail,
}) => {
  const isBasicApp = ['agent-chat', 'chat', 'completion'].includes(appDetail.mode)

  return <div className='h-full w-full'>
    {isBasicApp ? <BasicAppPreview appId={appId} /> : <FlowAppPreview appId={appId} className='h-full' />}
  </div>
}
export default React.memo(Preview)
