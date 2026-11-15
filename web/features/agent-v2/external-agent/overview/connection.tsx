import type { ExternalAgentOverview } from '../model'
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from '@langgenius/dify-ui/collapsible'
import { Infotip, InfotipContent, InfotipTrigger } from '@langgenius/dify-ui/infotip'
import { Switch } from '@langgenius/dify-ui/switch'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useAtomValue } from 'jotai'
import { useId } from 'react'
import { useTranslation } from 'react-i18next'
import { isCurrentWorkspaceManagerAtom } from '@/context/workspace-state'
import { consoleQuery } from '@/service/console'
import { EditExternalAgentConnection } from './edit-connection'

export type ExternalAgentConnectionProps = {
  overview: ExternalAgentOverview
  readOnly?: boolean
}

export function ExternalAgentConnection(props: ExternalAgentConnectionProps) {
  const { overview } = props
  const { t, i18n } = useTranslation(['agentRoster'])
  const canManage = useAtomValue(isCurrentWorkspaceManagerAtom)
  const verificationId = useId()
  const tracingId = useId()
  const members = useQuery(consoleQuery.workspaces.current.members.get.queryOptions({ input: {} }))
  const connectedBy =
    members.data?.accounts.find((member) => member.id === overview.connectedBy)?.name ??
    overview.connectedBy
  const tracing = useMutation(
    consoleQuery.externalAgents.byAgentId.tracing.put.mutationOptions({
      context: { silent: true },
    }),
  )
  const verifiedDate = overview.verifiedAt
    ? new Intl.DateTimeFormat(i18n.language, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        timeZone: 'UTC',
      }).format(new Date(overview.verifiedAt))
    : null

  return (
    <div className="rounded-xl bg-background-section p-4">
      <Collapsible defaultOpen className="border-b border-divider-subtle pb-4">
        <div className="flex items-center gap-1.5">
          <span aria-hidden className="i-ri-link size-3.5 shrink-0 text-text-tertiary" />
          <h2 className="system-sm-semibold text-text-primary">
            {t(($) => $['external.overview.connection'])}
          </h2>
          <span aria-hidden className="i-ri-book-open-line size-3.5 text-text-tertiary" />
          <div className="ms-auto">
            {!props.readOnly && canManage && <EditExternalAgentConnection overview={overview} />}
          </div>
          <CollapsibleTrigger
            className="group flex items-center justify-center rounded-sm"
            aria-label={t(($) => $['external.overview.connection'])}
          >
            <span
              aria-hidden
              className="i-ri-arrow-down-s-line size-4 text-text-tertiary group-data-panel-open:rotate-180"
            />
          </CollapsibleTrigger>
        </div>
        <CollapsiblePanel>
          <dl className="mt-2 space-y-2 system-xs-regular">
            <div>
              <dt className="py-0.5 text-text-tertiary">
                {t(($) => $['external.connection.endpoint'])}
              </dt>
              <dd className="font-mono leading-4.5 break-all text-text-secondary">
                {overview.endpoint}
              </dd>
            </div>
            <div className="grid grid-cols-[minmax(0,46%)_minmax(0,1fr)] gap-3 py-0.5">
              <dt className="text-text-tertiary">
                {t(($) => $['external.connection.authentication'])}
              </dt>
              <dd className="text-text-secondary">
                {overview.authentication === 'bearer'
                  ? t(($) => $['external.connection.bearerToken'])
                  : t(($) => $['external.connection.none'])}
              </dd>
            </div>
            <div className="grid grid-cols-[minmax(0,46%)_minmax(0,1fr)] gap-3 py-0.5">
              <dt className="text-text-tertiary">{t(($) => $['external.overview.protocol'])}</dt>
              <dd className="text-text-secondary">{overview.protocol || '—'}</dd>
            </div>
            <div className="grid grid-cols-[minmax(0,46%)_minmax(0,1fr)] gap-3 py-0.5">
              <dt className="flex items-center gap-1 text-text-tertiary">
                <span id={verificationId}>{t(($) => $['external.overview.verification'])}</span>
                <Infotip>
                  <InfotipTrigger aria-labelledby={verificationId} />
                  <InfotipContent aria-labelledby={verificationId}>
                    {t(($) => $['external.overview.verificationHint'])}
                  </InfotipContent>
                </Infotip>
              </dt>
              <dd className="text-text-secondary">
                {verifiedDate
                  ? t(($) => $['external.overview.verifiedAt'], { date: verifiedDate })
                  : '—'}
              </dd>
            </div>
            <div className="grid grid-cols-[minmax(0,46%)_minmax(0,1fr)] gap-3 py-0.5">
              <dt className="text-text-tertiary">{t(($) => $['external.overview.connectedBy'])}</dt>
              <dd className="flex items-center gap-1.5 text-text-secondary">
                <span
                  aria-hidden
                  className="flex size-4 shrink-0 items-center justify-center rounded-full border border-divider-regular bg-components-icon-bg-indigo-soft text-[10px] text-util-colors-indigo-indigo-600"
                >
                  {connectedBy.charAt(0)}
                </span>
                {connectedBy}
              </dd>
            </div>
          </dl>
        </CollapsiblePanel>
      </Collapsible>
      <div className="space-y-2 pt-4">
        <div className="flex items-center gap-1.5">
          <span aria-hidden className="i-ri-search-eye-line size-3.5 text-text-tertiary" />
          <h2 id={tracingId} className="system-sm-semibold text-text-primary">
            {t(($) => $['external.overview.tracing'])}
          </h2>
          <Infotip>
            <InfotipTrigger aria-labelledby={tracingId} />
            <InfotipContent aria-labelledby={tracingId}>
              {t(($) => $['external.overview.tracingHint'])}
            </InfotipContent>
          </Infotip>
          {props.readOnly ? (
            <span className="ms-auto system-xs-regular text-text-tertiary">
              {overview.tracing
                ? t(($) => $['external.overview.tracingOn'])
                : t(($) => $['external.overview.tracingOff'])}
            </span>
          ) : (
            <Switch
              className="ms-auto"
              checked={overview.tracing}
              onCheckedChange={(enabled) =>
                tracing.mutate({ params: { agent_id: overview.asset.id }, body: { enabled } })
              }
              aria-labelledby={tracingId}
              disabled={
                !canManage ||
                tracing.isPending ||
                (!overview.tracing && !overview.traceabilitySupported)
              }
            />
          )}
        </div>
        <p className="system-xs-regular text-text-tertiary">
          {t(($) => $['external.overview.tracingDescription'])}
        </p>
        {tracing.isError && (
          <p role="alert" className="system-xs-regular text-text-destructive">
            {t(($) => $['external.api.saveFailed'])}
          </p>
        )}
      </div>
    </div>
  )
}
