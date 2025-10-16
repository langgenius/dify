'use client'
import type { FC } from 'react'
import React from 'react'
import { useGetTryAppInfo } from '@/service/use-try-app'
import BasicAppPreview from './basic-app-preview'
import FlowAppPreview from './flow-app-preview'
import Loading from '@/app/components/base/loading'

type Props = {
  appId: string
}

const Preview: FC<Props> = ({
  appId,
}) => {
  const { data: appDetail, isLoading } = useGetTryAppInfo(appId)
  const isBasicApp = appDetail ? ['agent-chat', 'chat', 'completion'].includes(appDetail.mode) : false
  if (isLoading) {
    return <div className='flex h-full items-center justify-center'>
      <Loading type='area' />
    </div>
  }

  return isBasicApp ? <BasicAppPreview appId={appId} /> : <FlowAppPreview appId={appId} />
}
export default React.memo(Preview)
