'use client'

import { Button } from '@langgenius/dify-ui/button'
import {
  ScrollArea,
  ScrollAreaContent,
  ScrollAreaScrollbar,
  ScrollAreaThumb,
  ScrollAreaViewport,
} from '@langgenius/dify-ui/scroll-area'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import Loading from '@/app/components/base/loading'
import useTimestamp from '@/hooks/use-timestamp'
import { consoleQuery } from '@/service/client'

function ExternalAgentProperty({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-t border-divider-subtle px-4 py-3 first:border-t-0">
      <div className="system-xs-medium text-text-tertiary">{label}</div>
      <div className="mt-1 system-sm-regular wrap-break-word text-text-secondary">{value}</div>
    </div>
  )
}

export function ExternalAgentDetailPanel({ agentId }: { agentId: string }) {
  const { t } = useTranslation('agentV2')
  const { t: tCommon } = useTranslation('common')
  const { formatTime } = useTimestamp()
  const detailQuery = useQuery(
    consoleQuery.agent.byAgentId.external.get.queryOptions({
      input: { params: { agent_id: agentId } },
    }),
  )

  if (detailQuery.isPending) {
    return (
      <div className="flex h-full min-h-80 items-center justify-center" aria-busy>
        <Loading type="app" />
      </div>
    )
  }

  if (detailQuery.isError || !detailQuery.data) {
    return (
      <div className="flex h-full min-h-80 items-center justify-center px-6 text-center">
        <div>
          <span aria-hidden className="i-ri-error-warning-line size-6 text-text-warning" />
          <p className="mt-2 system-sm-medium text-text-secondary">
            {t(($) => $['externalAgent.errors.loadFailed'])}
          </p>
          <Button className="mt-3" onClick={() => void detailQuery.refetch()}>
            {tCommon(($) => $['operation.retry'])}
          </Button>
        </div>
      </div>
    )
  }

  const agent = detailQuery.data
  const skills = agent.agent_card.skills ?? []
  const capabilities = [
    {
      enabled: agent.agent_card.capabilities.streaming === true,
      key: 'streaming',
      label: t(($) => $['externalAgent.capabilities.streaming']),
    },
    {
      enabled: agent.agent_card.capabilities.pushNotifications === true,
      key: 'push-notifications',
      label: t(($) => $['externalAgent.capabilities.pushNotifications']),
    },
    {
      enabled: agent.agent_card.capabilities.extendedAgentCard === true,
      key: 'extended-card',
      label: t(($) => $['externalAgent.capabilities.extendedCard']),
    },
  ]
  const lastVerified = agent.last_verified_at
    ? formatTime(
        agent.last_verified_at,
        t(($) => $['roster.dateTimeFormat']),
      )
    : t(($) => $['externalAgent.detail.neverVerified'])

  return (
    <ScrollArea className="h-full overflow-hidden">
      <ScrollAreaViewport>
        <ScrollAreaContent className="pb-6">
          <section className="border-b border-divider-subtle py-1">
            <ExternalAgentProperty
              label={t(($) => $['externalAgent.endpoint.label'])}
              value={agent.endpoint}
            />
            <ExternalAgentProperty
              label={t(($) => $['externalAgent.protocol'])}
              value={`A2A ${agent.protocol_version}`}
            />
            <ExternalAgentProperty
              label={t(($) => $['externalAgent.detail.authentication'])}
              value={
                agent.auth_type === 'bearer'
                  ? t(($) => $['externalAgent.detail.bearerConfigured'])
                  : t(($) => $['externalAgent.auth.none'])
              }
            />
            <ExternalAgentProperty
              label={t(($) => $['externalAgent.detail.lastVerified'])}
              value={lastVerified}
            />
          </section>

          <section className="border-b border-divider-subtle px-4 py-4">
            <h3 className="system-xs-semibold-uppercase text-text-tertiary">
              {t(($) => $['externalAgent.detail.capabilitiesTitle'])}
            </h3>
            <div className="mt-2 space-y-2">
              {capabilities.map((capability) => (
                <div key={capability.key} className="flex items-center gap-2">
                  <span
                    aria-hidden
                    className={
                      capability.enabled
                        ? 'i-ri-checkbox-circle-fill size-4 text-text-success'
                        : 'i-ri-subtract-line size-4 text-text-quaternary'
                    }
                  />
                  <span className="system-sm-regular text-text-secondary">{capability.label}</span>
                </div>
              ))}
            </div>
          </section>

          <section className="px-4 py-4">
            <h3 className="system-xs-semibold-uppercase text-text-tertiary">
              {t(($) => $['externalAgent.detail.skillsTitle'])}
            </h3>
            {skills.length > 0 ? (
              <div className="mt-2 space-y-2">
                {skills.map((skill) => (
                  <div
                    key={skill.id}
                    className="rounded-lg border border-divider-subtle bg-background-section px-3 py-2"
                  >
                    <div className="system-sm-medium text-text-secondary">{skill.name}</div>
                    {skill.description && (
                      <p className="mt-0.5 system-xs-regular text-text-tertiary">
                        {skill.description}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <p className="mt-2 system-sm-regular text-text-tertiary">
                {t(($) => $['externalAgent.detail.noSkills'])}
              </p>
            )}
          </section>
        </ScrollAreaContent>
      </ScrollAreaViewport>
      <ScrollAreaScrollbar>
        <ScrollAreaThumb />
      </ScrollAreaScrollbar>
    </ScrollArea>
  )
}
