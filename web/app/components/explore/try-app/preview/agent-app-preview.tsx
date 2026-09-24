'use client'

import type {
  AgentAppComposerResponse,
  TrialAppDetailResponse,
} from '@dify/contracts/api/console/trial-apps/types.gen'
import { useTranslation } from 'react-i18next'
import AppIcon from '@/app/components/base/app-icon'
import { AgentTemplateOrchestration } from '@/features/agent-v2/template-preview'

type Props = Readonly<{
  appDetail: TrialAppDetailResponse
  composer: AgentAppComposerResponse
}>

export default function AgentAppPreview({ appDetail, composer }: Props) {
  const { t } = useTranslation(['agentV2'])
  const features = composer.agent_soul.app_features

  return (
    <div className="flex size-full min-h-0 overflow-hidden rounded-xl bg-background-default">
      <AgentTemplateOrchestration
        key={composer.active_config_snapshot?.id ?? composer.agent.id}
        agentId={composer.agent.id}
        appId={appDetail.id}
        versionId={composer.active_config_snapshot?.id}
        config={composer.agent_soul}
      />
      <div className="flex min-w-0 flex-1 items-center justify-center bg-background-body p-5">
        <section className="w-full max-w-115 rounded-xl border border-divider-subtle bg-background-default p-5 shadow-sm">
          <div className="mb-3 flex items-center gap-3">
            <AppIcon
              decorative
              size="large"
              iconType={appDetail.site.icon_type}
              icon={appDetail.site.icon ?? undefined}
              background={appDetail.site.icon_background ?? undefined}
              imageUrl={appDetail.site.icon_url ?? undefined}
            />
            <h2 className="system-md-semibold text-text-primary">{appDetail.name}</h2>
          </div>
          {appDetail.description && (
            <p className="mb-4 system-sm-regular text-text-tertiary">{appDetail.description}</p>
          )}
          {features?.opening_statement && (
            <p className="mb-3 system-sm-regular whitespace-pre-wrap text-text-secondary">
              {features.opening_statement}
            </p>
          )}
          {!!features?.suggested_questions?.length && (
            <ul className="space-y-1">
              {features.suggested_questions.map((question) => (
                <li
                  key={question}
                  className="rounded-lg bg-background-section px-3 py-2 system-xs-regular text-text-secondary"
                >
                  {question}
                </li>
              ))}
            </ul>
          )}
          <div
            aria-hidden="true"
            className="border-components-input-border-normal mt-3 rounded-lg border bg-components-input-bg-normal p-2"
          >
            <div className="system-xs-regular text-text-quaternary">
              {t(($) => $['agentDetail.configure.preview.inputPlaceholder'], {
                name: appDetail.name,
              })}
            </div>
            <div className="mt-3 flex items-center justify-end gap-2 text-text-quaternary">
              <span className="i-ri-attachment-2 size-4" />
              <span className="i-ri-mic-line size-4" />
              <span className="flex size-6 items-center justify-center rounded-md bg-components-button-primary-bg text-components-button-primary-text">
                <span className="i-ri-send-plane-2-fill size-4" />
              </span>
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}
