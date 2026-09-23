'use client'

import type { AgentAppComposerResponse } from '@dify/contracts/api/console/trial-apps/types.gen'
import { useQuery } from '@tanstack/react-query'
import { useId } from 'react'
import { useTranslation } from 'react-i18next'
import AppUnavailable from '@/app/components/base/app-unavailable'
import { consoleQuery } from '@/service/console'
import { ConfigureSection } from './agent-detail/configure/components/orchestrate/common/section'
import { AgentModelField } from './agent-detail/configure/components/orchestrate/model-config/field'
import { AgentOrchestrateReadOnlyContext } from './agent-detail/configure/components/orchestrate/read-only-context'

function PublishedConfiguration({ preview }: { preview: AgentAppComposerResponse }) {
  const { t } = useTranslation(['agentV2'])
  const { t: tCommon } = useTranslation(['common'])
  const id = useId()
  const soul = preview.agent_soul
  const sections = [
    {
      key: 'tools',
      label: t(($) => $['agentDetail.configure.tools.label']),
      items: [
        ...(soul.tools?.dify_tools ?? [])
          .filter((tool) => tool.enabled !== false)
          .map((tool) => ({
            name: tool.tool_name ?? '*',
            description: tool.description,
          })),
        ...(soul.tools?.cli_tools ?? [])
          .filter((tool) => tool.enabled !== false)
          .map((tool) => ({
            name: tool.name ?? tool.tool_name ?? tool.label ?? 'CLI',
            description: tool.description,
          })),
      ],
    },
    {
      key: 'knowledge',
      label: t(($) => $['agentDetail.configure.knowledgeRetrieval.label']),
      items: soul.knowledge?.sets ?? [],
    },
    {
      key: 'skills',
      label: t(($) => $['agentDetail.configure.skills.label']),
      items: soul.config_skills ?? [],
    },
    {
      key: 'files',
      label: t(($) => $['agentDetail.configure.files.label']),
      items: (soul.config_files ?? []).map((file) => ({ name: file.name, description: undefined })),
    },
  ]

  return (
    <div className="h-full overflow-y-auto rounded-lg bg-components-panel-bg p-4">
      <AgentOrchestrateReadOnlyContext value>
        <AgentModelField
          currentModel={
            soul.model
              ? { provider: soul.model.model_provider, model: soul.model.model }
              : undefined
          }
          onSelect={() => {}}
        />
      </AgentOrchestrateReadOnlyContext>
      <ConfigureSection
        label={t(($) => $['agentDetail.configure.prompt.label'])}
        labelId={`${id}-prompt`}
      >
        <p className="pb-4 system-sm-regular wrap-break-word whitespace-pre-wrap text-text-primary">
          {soul.prompt?.system_prompt || tCommon(($) => $.noData)}
        </p>
      </ConfigureSection>
      {sections.map(({ key, label, items }) => (
        <ConfigureSection key={key} label={label} labelId={`${id}-${key}`} rootClassName="pb-4">
          {items.length > 0 ? (
            <ul className="space-y-2">
              {items.map((item, index) => (
                <li key={`${item.name}-${index}`} className="rounded-lg bg-background-section p-3">
                  <p className="system-sm-semibold wrap-break-word text-text-primary">
                    {item.name}
                  </p>
                  {item.description && (
                    <p className="system-xs-regular wrap-break-word whitespace-pre-wrap text-text-tertiary">
                      {item.description}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="system-sm-regular text-text-tertiary">{tCommon(($) => $.noData)}</p>
          )}
        </ConfigureSection>
      ))}
    </div>
  )
}

export function AgentTrialPreview({ appId }: { appId: string }) {
  const { data, isPending, isError } = useQuery(
    consoleQuery.trialApps.byAppId.agentComposer.get.queryOptions({
      input: { params: { app_id: appId } },
    }),
  )

  if (isPending)
    return (
      <div aria-busy="true" className="h-full animate-pulse rounded-lg bg-background-section" />
    )
  if (isError) return <AppUnavailable className="size-full" />
  return <PublishedConfiguration preview={data} />
}
