'use client'
import type { AgentAppComposerResponse } from '@dify/contracts/api/console/trial-apps/types.gen'
import type { FC } from 'react'
import type { TryAppInfo } from '@/service/try-app'
import * as React from 'react'
import BasicAppPreview from './basic-app-preview'
import FlowAppPreview from './flow-app-preview'

const AgentAppPreview = React.lazy(() => import('./agent-app-preview'))

type Props = {
  readonly appId: string
  readonly appDetail: TryAppInfo
  readonly agentComposer?: AgentAppComposerResponse
}

const Preview: FC<Props> = ({ appId, appDetail, agentComposer }) => {
  const isBasicApp = ['agent-chat', 'chat', 'completion'].includes(appDetail.mode)

  return (
    <div className="size-full">
      {appDetail.mode === 'agent' && agentComposer ? (
        <AgentAppPreview appDetail={appDetail} composer={agentComposer} />
      ) : isBasicApp ? (
        <BasicAppPreview appId={appId} />
      ) : (
        <FlowAppPreview appId={appId} className="h-full" />
      )}
    </div>
  )
}
export default React.memo(Preview)
