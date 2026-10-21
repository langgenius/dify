import type { AppPartial } from '@dify/contracts/api/console/apps/types.gen'
import { Infotip, InfotipContent, InfotipTitle, InfotipTrigger } from '@langgenius/dify-ui/infotip'
import {
  ScrollArea,
  ScrollAreaContent,
  ScrollAreaScrollbar,
  ScrollAreaThumb,
  ScrollAreaViewport,
} from '@langgenius/dify-ui/scroll-area'
import { useTranslation } from 'react-i18next'

type Props = { app: AppPartial }

export function AppAvailabilityBadge({ app }: Props) {
  const { t } = useTranslation(['app'])
  if (app.availability !== 'unavailable') return null
  return (
    <span className="shrink-0 rounded bg-background-section-burn px-1.5 py-0.5 system-2xs-medium-uppercase text-text-tertiary">
      {t(($) => $['studio.availability.unavailable'])}
    </span>
  )
}

// Render alongside the card link, never a button nested inside that link.
export function AppAvailabilityDetails({ app }: Props) {
  const { t } = useTranslation(['app'])
  if (app.availability !== 'unavailable') return null
  const sources = {
    draft: t(($) => $['studio.availability.draft']),
    configuration: t(($) => $['studio.availability.configuration']),
  }
  const types = {
    model: t(($) => $['studio.availability.type.model']),
    tool: t(($) => $['studio.availability.type.tool']),
    knowledge: t(($) => $['studio.availability.type.knowledge']),
    agent: t(($) => $['studio.availability.type.agent']),
    workflow: t(($) => $['studio.availability.type.workflow']),
    configuration: t(($) => $['studio.availability.configuration']),
  }
  const reasons: Record<string, string> = {
    missing: t(($) => $['studio.availability.reason.missing']),
    disabled: t(($) => $['studio.availability.reason.disabled']),
    archived: t(($) => $['studio.availability.reason.disabled']),
    'not-configured': t(($) => $['studio.availability.reason.configuration']),
    'invalid-configuration': t(($) => $['studio.availability.reason.configuration']),
    unpublished: t(($) => $['studio.availability.reason.configuration']),
    'no-configure': t(($) => $['studio.availability.reason.credentials']),
    'no-configured': t(($) => $['studio.availability.reason.credentials']),
    'credential-removed': t(($) => $['studio.availability.reason.credentials']),
    'no-permission': t(($) => $['studio.availability.reason.permission']),
    'quota-exceeded': t(($) => $['studio.availability.reason.quota']),
    'evaluation-failed': t(($) => $['studio.availability.reason.evaluation']),
  }
  return (
    <Infotip>
      <InfotipTrigger
        iconVariant="warning"
        aria-label={t(($) => $['studio.availability.details'], { name: app.name })}
        openOnHover={false}
      />
      <InfotipContent placement="bottom-end" className="w-80 max-w-[calc(100vw-2rem)]">
        <InfotipTitle className="system-xs-semibold">{app.name}</InfotipTitle>
        {app.availability_source && <p className="mt-1">{sources[app.availability_source]}</p>}
        <p className="mt-1">{t(($) => $['studio.availability.hint'])}</p>
        <ScrollArea className="mt-2 max-h-60">
          <ScrollAreaViewport
            role="region"
            aria-label={t(($) => $['studio.availability.details'], { name: app.name })}
            className="max-h-60"
          >
            <ScrollAreaContent>
              <ul className="space-y-2">
                {(app.availability_reasons ?? []).map((issue) => (
                  <li key={JSON.stringify(issue)} className="wrap-anywhere">
                    <div className="system-xs-semibold">{types[issue.type]}</div>
                    <div>
                      {[issue.provider, issue.model, issue.resource_id].filter(Boolean).join(' · ')}
                    </div>
                    <div>
                      {reasons[issue.reason] ??
                        t(($) => $['studio.availability.reason.configuration'])}
                    </div>
                  </li>
                ))}
              </ul>
            </ScrollAreaContent>
          </ScrollAreaViewport>
          <ScrollAreaScrollbar>
            <ScrollAreaThumb />
          </ScrollAreaScrollbar>
        </ScrollArea>
      </InfotipContent>
    </Infotip>
  )
}
