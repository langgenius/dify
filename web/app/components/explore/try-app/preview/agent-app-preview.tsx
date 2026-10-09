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
    <div className="flex h-[75dvh] min-h-0 w-full flex-col gap-2 overflow-visible bg-background-default lg:h-full @max-[599px]/agent-preview:h-auto @min-[600px]/agent-preview:flex-row @min-[600px]/agent-preview:gap-0 @min-[600px]/agent-preview:overflow-hidden">
      <AgentTemplateOrchestration
        key={composer.active_config_snapshot?.id ?? composer.agent.id}
        agentId={composer.agent.id}
        appId={appDetail.id}
        versionId={composer.active_config_snapshot?.id}
        config={composer.agent_soul}
      />
      <div className="relative min-w-0 flex-1 overflow-hidden rounded-md bg-background-body pt-1 pr-1 pb-1 @max-[599px]/agent-preview:h-[65dvh] @max-[599px]/agent-preview:flex-none">
        <AgentTemplateGridBackground />
        <section
          aria-labelledby={previewHeadingId}
          className="relative z-1 flex h-full min-h-0 flex-col px-4 pb-4"
        >
          <div className="flex h-12 shrink-0 items-center gap-2 py-3">
            <h2 id={previewHeadingId} className="title-xl-semi-bold text-text-primary">
              {t(($) => $['agentDetail.configure.templatePreview.agentUI'])}
            </h2>
            <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-[5px] border border-divider-deep bg-components-badge-bg-dimm px-1 system-2xs-medium-uppercase text-text-tertiary">
              {t(($) => $['agentDetail.configure.rightPanel.preview'])}
            </span>
          </div>
          <div className="flex min-h-0 flex-1 flex-col gap-3 rounded-2xl bg-components-panel-bg p-6 shadow-xs">
            <div className="min-h-0 flex-1 overflow-y-auto wrap-break-word">
              <div className="flex flex-col gap-4">
                <div className="flex flex-col gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <AppIcon
                      decorative
                      size="tiny"
                      iconType={appDetail.site.icon_type}
                      icon={appDetail.site.icon ?? undefined}
                      background={appDetail.site.icon_background ?? undefined}
                      imageUrl={appDetail.site.icon_url ?? undefined}
                    />
                    <h3 className="min-w-0 system-xl-semibold text-text-primary">
                      {appDetail.name}
                    </h3>
                  </div>
                  {features?.opening_statement && (
                    <p className="body-sm-regular whitespace-pre-wrap text-text-secondary">
                      {features.opening_statement}
                    </p>
                  )}
                </div>
                {!!features?.suggested_questions?.length && (
                  <ul className="flex flex-col items-start gap-1">
                    {features.suggested_questions.map((question) => (
                      <li
                        key={question}
                        className="max-w-full rounded-xl bg-workflow-canvas-workflow-bg px-2.5 py-2 system-xs-regular text-text-secondary"
                      >
                        {question}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
            <div
              aria-hidden="true"
              className="flex h-12 shrink-0 items-center rounded-xl border border-components-panel-border-subtle bg-components-panel-bg-alt p-2"
            >
              <span className="min-w-0 flex-1 truncate px-1 body-md-regular text-text-disabled">
                {t(($) => $['agentDetail.configure.preview.inputPlaceholder'], {
                  name: appDetail.name,
                })}
              </span>
              <span className="flex shrink-0 items-center gap-3 text-text-disabled">
                <span className="flex items-center gap-1">
                  <span className="flex size-8 items-center justify-center">
                    <span className="i-ri-attachment-2 size-4.5" />
                  </span>
                  <span className="flex size-8 items-center justify-center">
                    <span className="i-ri-mic-line size-4.5" />
                  </span>
                </span>
                <span className="flex size-8 items-center justify-center rounded-lg bg-components-button-primary-bg-disabled text-components-button-primary-text-disabled">
                  <span className="i-ri-send-plane-2-fill size-4" />
                </span>
              </span>
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}
