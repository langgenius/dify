'use client'

import { cn } from '@langgenius/dify-ui/cn'
import { Infotip, InfotipContent, InfotipTrigger } from '@langgenius/dify-ui/infotip'
import { useId } from 'react'
import { useTranslation } from 'react-i18next'
import AppIcon from '@/app/components/base/app-icon'
import useDocumentTitle from '@/hooks/use-document-title'
import { useExternalAgentPreview } from '../state'
import { ExternalAgentOverviewActions } from './actions'
import { ExternalAgentSkills } from './agent-skills'
import { ExternalAgentConnection } from './connection'
import { ExternalAgentServiceDetails } from './service-details'
import { ExternalAgentUsedInApps } from './used-in-apps'

function DefaultFormats({
  label,
  hint,
  formats,
}: {
  label: string
  hint: string
  formats: string[]
}) {
  const labelId = useId()
  return (
    <div className="flex items-center gap-1 system-xs-regular text-text-tertiary">
      <span id={labelId}>{label}</span>
      <Infotip>
        <InfotipTrigger aria-labelledby={labelId} />
        <InfotipContent aria-labelledby={labelId}>{hint}</InfotipContent>
      </Infotip>
      <span className="px-0.5 system-xs-medium text-text-secondary">{formats.join(', ')}</span>
    </div>
  )
}

export function ExternalAgentOverviewPage({ agentId }: { agentId: string }) {
  const { t } = useTranslation(['agentRoster'])
  const { preview, updatePreview } = useExternalAgentPreview(agentId)
  const { agent } = preview
  useDocumentTitle(agent.name)

  return (
    <div className="my-1 me-1 min-h-0 flex-1 overflow-y-auto rounded-lg bg-background-default">
      <div className="flex flex-wrap items-center gap-4 p-6">
        <AppIcon
          icon={agent.icon}
          size="xl"
          fallback={{
            content: <span className="i-ri-robot-2-line size-7 text-text-tertiary" />,
            background: 'var(--color-components-icon-bg-midnight-soft)',
          }}
        />
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="title-2xl-semi-bold font-bold wrap-break-word text-text-primary">
              {agent.name}
            </h1>
            <span
              className={cn(
                'rounded-md border px-1.25 py-0.5 system-xs-medium',
                agent.enabled
                  ? 'border-text-success text-text-success'
                  : 'border-divider-deep text-text-tertiary',
              )}
            >
              {agent.enabled
                ? t(($) => $['external.filters.enabled'])
                : t(($) => $['external.filters.disabled'])}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2 system-sm-regular">
            <span className="text-text-tertiary">{t(($) => $['external.overview.type'])}</span>
            {agent.role && (
              <>
                <span aria-hidden className="h-3 w-px bg-divider-deep" />
                <span className="wrap-break-word text-text-secondary">{agent.role}</span>
              </>
            )}
          </div>
        </div>
        <ExternalAgentOverviewActions
          agent={agent}
          sampleResponse={preview.sampleResponse}
          onUpdate={(agent) => updatePreview({ agent })}
        />
      </div>
      <div className="grid items-start gap-10 px-6 pb-8 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="flex min-w-0 flex-col gap-8 pt-4">
          <section>
            <h2 className="pb-2 body-lg-regular leading-6 font-medium text-text-secondary">
              {t(($) => $['external.overview.about'])}
            </h2>
            <p className="body-md-regular wrap-break-word text-text-secondary">
              {agent.description}
            </p>
            <div className="mt-2 flex flex-wrap gap-x-5 gap-y-2">
              <DefaultFormats
                label={t(($) => $['external.overview.defaultInputFormats'])}
                hint={t(($) => $['external.overview.defaultInputFormatsHint'])}
                formats={preview.defaultInputFormats}
              />
              <DefaultFormats
                label={t(($) => $['external.overview.defaultOutputFormats'])}
                hint={t(($) => $['external.overview.defaultOutputFormatsHint'])}
                formats={preview.defaultOutputFormats}
              />
            </div>
          </section>
          <ExternalAgentSkills skills={preview.skills} />
          <ExternalAgentUsedInApps apps={agent.apps} />
        </div>
        <div className="flex min-w-0 flex-col gap-4 pt-4">
          <ExternalAgentConnection preview={preview} onUpdate={updatePreview} />
          <ExternalAgentServiceDetails
            provider={preview.provider}
            version={preview.version}
            documentationUrl={preview.documentationUrl}
          />
        </div>
      </div>
    </div>
  )
}
