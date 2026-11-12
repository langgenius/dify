import type { ExternalAgentOverview } from '../model'
import { buttonVariants } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from '@langgenius/dify-ui/collapsible'
import { useTranslation } from 'react-i18next'

export function ExternalAgentServiceDetails({
  provider,
  version,
  documentationUrl,
}: Pick<ExternalAgentOverview, 'provider' | 'version' | 'documentationUrl'>) {
  const { t } = useTranslation(['agentRoster'])

  return (
    <Collapsible defaultOpen className="rounded-xl bg-background-section p-4">
      <h2>
        <CollapsibleTrigger className="group flex w-full items-center gap-1.5 rounded-sm system-sm-semibold text-text-primary">
          <span aria-hidden className="i-ri-file-text-line size-3.5 text-text-tertiary" />
          {t(($) => $['external.overview.serviceDetails'])}
          <span
            aria-hidden
            className="ms-auto i-ri-arrow-down-s-line size-4 text-text-tertiary group-data-panel-open:rotate-180"
          />
        </CollapsibleTrigger>
      </h2>
      <CollapsiblePanel>
        <dl className="mt-3.5 space-y-2 system-xs-regular">
          <div className="grid grid-cols-[minmax(0,41%)_minmax(0,1fr)] gap-3 py-0.5">
            <dt className="text-text-tertiary">{t(($) => $['external.overview.provider'])}</dt>
            <dd className="text-text-secondary">{provider || '—'}</dd>
          </div>
          <div className="grid grid-cols-[minmax(0,41%)_minmax(0,1fr)] gap-3 py-0.5">
            <dt className="text-text-tertiary">{t(($) => $['external.overview.version'])}</dt>
            <dd className="text-text-secondary">{version || '—'}</dd>
          </div>
          {documentationUrl && (
            <div className="grid grid-cols-[minmax(0,41%)_minmax(0,1fr)] items-start gap-3 pt-1">
              <dt className="text-text-tertiary">
                {t(($) => $['external.overview.providerDocs'])}
              </dt>
              <dd>
                <a
                  href={documentationUrl}
                  target="_blank"
                  rel="noreferrer"
                  className={cn(
                    buttonVariants({ variant: 'ghost', size: 'small' }),
                    'h-auto gap-0.5 p-0 text-start system-xs-medium whitespace-normal',
                  )}
                >
                  {t(($) => $['external.overview.viewDocs'])}
                  <span aria-hidden className="i-ri-arrow-right-up-line size-3.5 shrink-0" />
                </a>
              </dd>
            </div>
          )}
        </dl>
      </CollapsiblePanel>
    </Collapsible>
  )
}
