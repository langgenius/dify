'use client'

import useDocumentTitle from '@/hooks/use-document-title'
import { useExternalAgentPreview } from '../state'
import { ExternalAgentOverviewActions } from './actions'
import { ExternalAgentOverviewContent } from './content'
import { ExternalAgentIdentity } from './identity'

export function ExternalAgentOverviewPage({ agentId }: { agentId: string }) {
  const { preview, updatePreview } = useExternalAgentPreview(agentId)
  useDocumentTitle(preview.agent.name)

  return (
    <div className="my-1 me-1 flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg bg-background-default">
      <div className="flex shrink-0 flex-wrap items-center gap-4 p-6">
        <ExternalAgentIdentity agent={preview.agent} />
        <ExternalAgentOverviewActions
          preview={preview}
          onUpdate={(agent) => updatePreview({ agent })}
        />
      </div>
      <div
        data-external-agent-overview-scroll
        className="@container/external-agent isolate min-h-0 flex-1 overflow-y-auto"
      >
        <ExternalAgentOverviewContent preview={preview} onUpdate={updatePreview} />
      </div>
    </div>
  )
}
