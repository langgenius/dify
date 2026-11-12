import type { ExternalAgentConnectionProps } from './connection'
import { cn } from '@langgenius/dify-ui/cn'
import { Infotip, InfotipContent, InfotipTrigger } from '@langgenius/dify-ui/infotip'
import { useId } from 'react'
import { useTranslation } from 'react-i18next'
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

export function ExternalAgentOverviewContent(props: ExternalAgentConnectionProps) {
  const { preview } = props
  const { t } = useTranslation(['agentRoster'])
  return (
    <div
      className={cn(
        'grid items-start gap-10 px-6 @4xl/external-agent:grid-cols-[minmax(0,1fr)_380px]',
        props.readOnly ? 'pb-12' : 'pb-8',
      )}
    >
      <div className="flex min-w-0 flex-col gap-8 pt-4">
        <section>
          <h2 className="pb-2 body-lg-regular leading-6 font-medium text-text-secondary">
            {t(($) => $['external.overview.about'])}
          </h2>
          <p className="body-md-regular wrap-break-word text-text-secondary">
            {preview.agent.description}
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
        <ExternalAgentUsedInApps apps={preview.agent.apps} />
      </div>
      <div
        className={cn(
          'flex min-w-0 flex-col gap-4 @4xl/external-agent:sticky',
          props.readOnly ? 'mt-4 @4xl/external-agent:top-4' : 'mt-6 @4xl/external-agent:top-6',
        )}
      >
        <ExternalAgentConnection {...props} />
        <ExternalAgentServiceDetails
          provider={preview.provider}
          version={preview.version}
          documentationUrl={preview.documentationUrl}
        />
      </div>
    </div>
  )
}
