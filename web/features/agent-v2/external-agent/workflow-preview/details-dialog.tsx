import { DialogClose, DialogContent } from '@langgenius/dify-ui/dialog'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { useQuery } from '@tanstack/react-query'
import { useId } from 'react'
import { useTranslation } from 'react-i18next'
import { consoleQuery } from '@/service/console'
import { toExternalAgentOverview } from '../model'
import { ExternalAgentOverviewContent } from '../overview/content'
import { ExternalAgentIdentity } from '../overview/identity'

export function ExternalAgentDetailsDialogContent({ agentId }: { agentId: string }) {
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
      <ExternalAgentDetails agentId={agentId} />
    </DialogContent>
  )
}

function ExternalAgentDetails({ agentId }: { agentId: string }) {
  const { t } = useTranslation(['agentRoster'])
  const query = useQuery(
    consoleQuery.externalAgents.byAgentId.get.queryOptions({
      input: { params: { agent_id: agentId } },
      select: toExternalAgentOverview,
    }),
  )
  if (query.isPending)
    return <div aria-hidden className="m-6 h-60 animate-pulse rounded-xl bg-state-base-hover-alt" />
  if (query.isError)
    return (
      <p role="status" className="p-6 system-sm-regular text-text-tertiary">
        {t(($) => $['external.workflow.detailUnavailable'])}
      </p>
    )
  const overview = query.data
  return (
    <>
      <div className="flex shrink-0 items-center gap-4 p-6">
        <ExternalAgentIdentity agent={overview.agent} heading="h2" />
      </div>
      <div
        data-external-agent-overview-scroll
        className="@container/external-agent isolate min-h-0 flex-1 overflow-x-hidden overflow-y-auto"
      >
        <ExternalAgentOverviewContent overview={overview} readOnly />
      </div>
    </>
  )
}
