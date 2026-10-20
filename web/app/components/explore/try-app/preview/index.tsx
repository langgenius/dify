'use client'
import type {
  AgentAppComposerResponse,
  TrialAppDetailResponse,
} from '@dify/contracts/api/console/trial-apps/types.gen'
import type { FC } from 'react'
import { cn } from '@langgenius/dify-ui/cn'
import * as React from 'react'
import BasicAppPreview from './basic-app-preview'
import FlowAppPreview from './flow-app-preview'

const AgentAppPreview = React.lazy(() => import('./agent-app-preview'))

type Props = {
  readonly appId: string
  readonly appDetail: TrialAppDetailResponse
  readonly agentComposer?: AgentAppComposerResponse
}

const Preview: FC<Props> = ({ appId, appDetail, agentComposer }) => {
  const isBasicApp = ['agent-chat', 'chat', 'completion'].includes(appDetail.mode)

  return (
    <div className={cn('size-full', appDetail.mode === 'agent' && 'max-lg:h-auto')}>
      {appDetail.mode === 'agent' && agentComposer ? (
        <AgentAppPreview appDetail={appDetail} composer={agentComposer} />
      ) : isBasicApp ? (
        <BasicAppPreview appId={appId} appDetail={appDetail} />
      ) : (
        <FlowAppPreview appId={appId} className="h-full" />
      )}
    </div>
  )
}
export default React.memo(Preview)
