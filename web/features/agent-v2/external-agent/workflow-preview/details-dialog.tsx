import type { ExternalAgentWorkflowPreviewAgent } from './types'
import { DialogClose, DialogContent } from '@langgenius/dify-ui/dialog'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { useId } from 'react'
import { useTranslation } from 'react-i18next'
import { ExternalAgentOverviewContent } from '../overview/content'
import { ExternalAgentIdentity } from '../overview/identity'
import { useExternalAgentPreview } from '../state'

export function ExternalAgentDetailsDialogContent({
  agent,
}: {
  agent: ExternalAgentWorkflowPreviewAgent
}) {
  const { t } = useTranslation(['agentRoster', 'common'])
  const titleId = useId()
  return (
    <DialogContent
      aria-labelledby={titleId}
      className="max-h-[calc(100dvh-4rem)] w-320 overflow-hidden"
    >
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-divider-subtle py-3.5 ps-6 pe-5">
        <h2 id={titleId} className="system-sm-semibold text-text-primary">
          {t(($) => $['external.connection.details'])}
        </h2>
        <DialogClose
          render={
            <IconButton size="xs" aria-label={t(($) => $['operation.close'], { ns: 'common' })}>
              <span aria-hidden className="i-ri-close-line size-4" />
            </IconButton>
          }
        />
      </div>
      <ExternalAgentDetails agent={agent} />
    </DialogContent>
  )
}

function ExternalAgentDetails({ agent }: { agent: ExternalAgentWorkflowPreviewAgent }) {
  const { preview } = useExternalAgentPreview(agent.key, agent)
  return (
    <>
      <div className="flex shrink-0 items-center gap-4 p-6">
        <ExternalAgentIdentity agent={preview.agent} heading="h2" />
      </div>
      <div
        data-external-agent-overview-scroll
        className="@container/external-agent isolate min-h-0 flex-1 overflow-x-hidden overflow-y-auto"
      >
        <ExternalAgentOverviewContent preview={preview} readOnly />
      </div>
    </>
  )
}
