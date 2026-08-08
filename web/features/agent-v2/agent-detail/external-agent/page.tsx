'use client'

import type { ExternalAgentDetailResponse } from '@dify/contracts/api/console/agent/types.gen'
import { Button } from '@langgenius/dify-ui/button'
import {
  ScrollArea,
  ScrollAreaContent,
  ScrollAreaScrollbar,
  ScrollAreaThumb,
  ScrollAreaViewport,
} from '@langgenius/dify-ui/scroll-area'
import { StatusDot } from '@langgenius/dify-ui/status-dot'
import { toast } from '@langgenius/dify-ui/toast'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import Loading from '@/app/components/base/loading'
import useTimestamp from '@/hooks/use-timestamp'
import { consoleQuery } from '@/service/client'
import { AgentKindBadge } from '../../components/agent-kind-badge'
import { getExternalAgentErrorMessage } from '../../roster/components/external-agent-errors'
import { AgentDetailSectionSurface } from '../section-surface'
import { EditExternalAgentDialog } from './edit-external-agent-dialog'

type ExternalAgentConnectionPageProps = {
  agentId: string
}

function DetailRow({
  label,
  value,
  code = false,
}: {
  label: string
  value: string
  code?: boolean
}) {
  return (
    <div className="grid min-h-10 grid-cols-[140px_minmax(0,1fr)] items-center gap-4 border-t border-divider-subtle py-2 first:border-t-0">
      <dt className="system-xs-medium text-text-tertiary">{label}</dt>
      <dd
        className={
          code
            ? 'truncate code-sm-regular text-text-secondary'
            : 'truncate system-sm-regular text-text-secondary'
        }
        title={value}
      >
        {value}
      </dd>
    </div>
  )
}

function ConnectionOverview({ agent }: { agent: ExternalAgentDetailResponse }) {
  const { t } = useTranslation('agentV2')
  const { formatTime } = useTimestamp()
  const lastVerified = agent.last_verified_at
    ? formatTime(
        agent.last_verified_at,
        t(($) => $['roster.dateTimeFormat']),
      )
    : t(($) => $['externalAgent.detail.neverVerified'])

  return (
    <article className="rounded-xl border border-components-panel-border bg-components-panel-bg shadow-xs">
      <div className="flex min-w-0 items-center gap-3 px-4 py-4">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-[10px] border border-divider-subtle bg-background-section text-text-tertiary">
          <span aria-hidden className="i-ri-link-m size-4.5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <h3 className="truncate system-md-semibold text-text-primary">{agent.name}</h3>
            <AgentKindBadge agentKind={agent.agent_kind} />
          </div>
          <p className="mt-0.5 line-clamp-2 system-xs-regular text-text-tertiary">
            {agent.description}
          </p>
        </div>
        <span className="inline-flex shrink-0 items-center gap-1 system-xs-semibold-uppercase text-text-success">
          <StatusDot status="success" size="small" />
          {t(($) => $['externalAgent.detail.connected'])}
        </span>
      </div>

      <dl className="border-t border-divider-subtle px-4 py-2">
        <DetailRow
          label={t(($) => $['externalAgent.endpoint.label'])}
          value={agent.endpoint}
          code
        />
        <DetailRow
          label={t(($) => $['externalAgent.protocol'])}
          value={`A2A ${agent.protocol_version}`}
        />
        <DetailRow
          label={t(($) => $['externalAgent.detail.authentication'])}
          value={
            agent.auth_type === 'bearer'
              ? t(($) => $['externalAgent.detail.bearerConfigured'])
              : t(($) => $['externalAgent.auth.none'])
          }
        />
        <DetailRow label={t(($) => $['externalAgent.detail.lastVerified'])} value={lastVerified} />
      </dl>
    </article>
  )
}

function CapabilitiesCard({ agent }: { agent: ExternalAgentDetailResponse }) {
  const { t } = useTranslation('agentV2')
  const capabilities = [
    {
      key: 'streaming',
      label: t(($) => $['externalAgent.capabilities.streaming']),
      enabled: agent.agent_card.capabilities.streaming === true,
    },
    {
      key: 'push-notifications',
      label: t(($) => $['externalAgent.capabilities.pushNotifications']),
      enabled: agent.agent_card.capabilities.pushNotifications === true,
    },
    {
      key: 'extended-card',
      label: t(($) => $['externalAgent.capabilities.extendedCard']),
      enabled: agent.agent_card.capabilities.extendedAgentCard === true,
    },
  ]
  const skills = agent.agent_card.skills ?? []

  return (
    <article className="rounded-xl border border-components-panel-border bg-components-panel-bg shadow-xs">
      <div className="border-b border-divider-subtle px-4 py-3">
        <h3 className="system-md-semibold text-text-primary">
          {t(($) => $['externalAgent.detail.capabilitiesTitle'])}
        </h3>
        <p className="mt-0.5 system-xs-regular text-text-tertiary">
          {t(($) => $['externalAgent.detail.capabilitiesDescription'])}
        </p>
      </div>
      <div className="grid grid-cols-1 gap-px bg-divider-subtle sm:grid-cols-3">
        {capabilities.map((capability) => (
          <div
            key={capability.key}
            className="flex min-h-14 items-center gap-2 bg-components-panel-bg px-4 py-3"
          >
            <span
              aria-hidden
              className={
                capability.enabled
                  ? 'i-ri-checkbox-circle-fill size-4 shrink-0 text-text-success'
                  : 'i-ri-subtract-line size-4 shrink-0 text-text-quaternary'
              }
            />
            <span className="system-sm-medium text-text-secondary">{capability.label}</span>
          </div>
        ))}
      </div>
      <div className="border-t border-divider-subtle px-4 py-4">
        <div className="system-xs-medium text-text-tertiary">
          {t(($) => $['externalAgent.detail.skillsTitle'])}
        </div>
        {skills.length > 0 ? (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {skills.map((skill) => (
              <span
                key={skill.id}
                title={skill.description}
                className="max-w-52 truncate rounded-[5px] border border-divider-deep bg-components-badge-bg-dimm px-1.5 py-0.5 system-xs-medium text-text-tertiary"
              >
                {skill.name}
              </span>
            ))}
          </div>
        ) : (
          <p className="mt-1 system-sm-regular text-text-tertiary">
            {t(($) => $['externalAgent.detail.noSkills'])}
          </p>
        )}
      </div>
    </article>
  )
}

export function ExternalAgentConnectionPage({ agentId }: ExternalAgentConnectionPageProps) {
  const { t } = useTranslation('agentV2')
  const { t: tCommon } = useTranslation('common')
  const queryClient = useQueryClient()
  const [editOpen, setEditOpen] = useState(false)
  const detailQuery = useQuery(
    consoleQuery.agent.byAgentId.external.get.queryOptions({
      input: { params: { agent_id: agentId } },
    }),
  )
  const testMutation = useMutation(
    consoleQuery.agent.byAgentId.external.test.post.mutationOptions(),
  )

  const handleTest = async () => {
    if (testMutation.isPending) return

    try {
      const result = await testMutation.mutateAsync({ params: { agent_id: agentId } })
      await queryClient.invalidateQueries({
        queryKey: consoleQuery.agent.byAgentId.external.get.key({
          input: { params: { agent_id: agentId } },
        }),
      })
      toast.success(
        t(($) => $['externalAgent.testSuccess'], {
          latency: result.latency_ms,
        }),
      )
    } catch (error) {
      toast.error(
        (await getExternalAgentErrorMessage(error)) ??
          t(($) => $['externalAgent.errors.testFailed']),
      )
    }
  }

  return (
    <AgentDetailSectionSurface label={t(($) => $['agentDetail.sections.connection'])}>
      <header className="flex min-h-15.5 shrink-0 items-start justify-between gap-4 px-6 pt-3 pb-2">
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            <h2 className="system-xl-semibold text-text-primary">
              {t(($) => $['externalAgent.detail.title'])}
            </h2>
            <AgentKindBadge agentKind="external_agent" />
          </div>
          <p className="mt-1 system-xs-regular text-text-tertiary">
            {t(($) => $['externalAgent.detail.description'])}
          </p>
        </div>
        {detailQuery.data && (
          <div className="flex shrink-0 items-center gap-2">
            <Button
              size="medium"
              loading={testMutation.isPending}
              disabled={testMutation.isPending}
              onClick={() => void handleTest()}
            >
              <span aria-hidden className="i-ri-pulse-line size-4" />
              {t(($) => $['externalAgent.detail.testConnection'])}
            </Button>
            <Button size="medium" variant="primary" onClick={() => setEditOpen(true)}>
              <span aria-hidden className="i-ri-edit-line size-4" />
              {t(($) => $['externalAgent.detail.editConnection'])}
            </Button>
          </div>
        )}
      </header>

      {detailQuery.isPending ? (
        <div className="flex min-h-0 flex-1 items-center justify-center" aria-busy>
          <Loading type="app" />
        </div>
      ) : detailQuery.isError || !detailQuery.data ? (
        <div className="flex min-h-0 flex-1 items-center justify-center px-6">
          <div className="flex max-w-96 flex-col items-center text-center">
            <span aria-hidden className="i-ri-error-warning-line size-6 text-text-warning" />
            <p className="mt-2 system-sm-medium text-text-secondary">
              {t(($) => $['externalAgent.errors.loadFailed'])}
            </p>
            <Button className="mt-3" onClick={() => void detailQuery.refetch()}>
              {tCommon(($) => $['operation.retry'])}
            </Button>
          </div>
        </div>
      ) : (
        <ScrollArea className="min-h-0 flex-1 overflow-hidden">
          <ScrollAreaViewport>
            <ScrollAreaContent className="px-6 pt-2 pb-8">
              <div className="w-full min-w-0 space-y-3">
                <ConnectionOverview agent={detailQuery.data} />
                <CapabilitiesCard agent={detailQuery.data} />
              </div>
            </ScrollAreaContent>
          </ScrollAreaViewport>
          <ScrollAreaScrollbar>
            <ScrollAreaThumb />
          </ScrollAreaScrollbar>
        </ScrollArea>
      )}

      {detailQuery.data && editOpen && (
        <EditExternalAgentDialog
          key={`${detailQuery.data.id}:${detailQuery.data.updated_at ?? 'initial'}`}
          agent={detailQuery.data}
          open={editOpen}
          onOpenChange={setEditOpen}
        />
      )}
    </AgentDetailSectionSurface>
  )
}
