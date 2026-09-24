'use client'

import type {
  AgentAppComposerResponse,
  TrialAppDetailResponse,
} from '@dify/contracts/api/console/trial-apps/types.gen'
import { useId } from 'react'
import { useTranslation } from 'react-i18next'
import AppIcon from '@/app/components/base/app-icon'
import { AgentTemplateOrchestration } from '@/features/agent-v2/template-preview'
import { AgentTemplateGridBackground } from '@/features/agent-v2/template-preview/grid-background'

type Props = Readonly<{
  appDetail: TrialAppDetailResponse
  composer: AgentAppComposerResponse
}>

export default function AgentAppPreview({ appDetail, composer }: Props) {
  const { t } = useTranslation(['agentV2'])
  const previewHeadingId = useId()
  const features = composer.agent_soul.app_features

  return (
    <div className="flex size-full min-h-0 overflow-hidden bg-background-default">
      <AgentTemplateOrchestration
        key={composer.active_config_snapshot?.id ?? composer.agent.id}
        agentId={composer.agent.id}
        appId={appDetail.id}
        versionId={composer.active_config_snapshot?.id}
        config={composer.agent_soul}
      />
      <div className="relative flex min-w-0 flex-1 items-center justify-center overflow-hidden rounded-md bg-background-body px-6 py-5">
        <AgentTemplateGridBackground />
        <section
          aria-labelledby={previewHeadingId}
          className="relative z-1 max-h-full w-full max-w-120 overflow-auto rounded-2xl bg-workflow-block-bg p-6 break-words"
        >
          <div className="py-3">
            <AppIcon
              decorative
              size="medium"
              rounded
              iconType={appDetail.site.icon_type}
              icon={appDetail.site.icon ?? undefined}
              background={appDetail.site.icon_background ?? undefined}
              imageUrl={appDetail.site.icon_url ?? undefined}
            />
            <h2 id={previewHeadingId} className="mt-3 system-md-semibold text-text-secondary">
              {appDetail.name}
            </h2>
            {appDetail.description && (
              <p className="mt-1 body-sm-regular text-text-tertiary">{appDetail.description}</p>
            )}
          </div>
          {features?.opening_statement && (
            <p className="mb-3 body-sm-regular whitespace-pre-wrap text-text-secondary">
              {features.opening_statement}
            </p>
          )}
          {!!features?.suggested_questions?.length && (
            <ul className="mt-3 flex flex-col items-start gap-1">
              {features.suggested_questions.map((question) => (
                <li
                  key={question}
                  className="max-w-full rounded-xl bg-workflow-canvas-workflow-bg px-2.5 py-2 system-xs-regular text-text-tertiary"
                >
                  {question}
                </li>
              ))}
            </ul>
          )}
          <div
            aria-hidden="true"
            className="mt-3 flex min-h-12 items-center gap-2 rounded-xl border border-components-panel-border-subtle bg-components-panel-bg-alt p-2"
          >
            <div className="min-w-0 flex-1 truncate px-1 body-md-regular text-text-disabled">
              {t(($) => $['agentDetail.configure.preview.inputPlaceholder'], {
                name: appDetail.name,
              })}
            </div>
            <div className="flex shrink-0 items-center gap-3 text-text-disabled">
              <span className="i-ri-attachment-2 size-4.5" />
              <span className="i-ri-mic-line size-4.5" />
              <span className="flex size-8 items-center justify-center rounded-lg bg-components-button-primary-bg-disabled text-components-button-primary-text-disabled">
                <span className="i-ri-send-plane-2-fill size-4" />
              </span>
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}
