import type { ExternalAgentOverviewPreview } from '../preview'
import { useTranslation } from 'react-i18next'
import Link from '@/next/link'

export function ExternalAgentUsedInApps({
  apps,
}: {
  apps: ExternalAgentOverviewPreview['agent']['apps']
}) {
  const { t } = useTranslation(['agentRoster', 'app'])
  return (
    <section>
      <h2 className="flex items-center gap-2 pb-2 body-lg-regular leading-6 font-medium text-text-secondary">
        {t(($) => $['external.overview.usedInApps'])}
        <span className="system-sm-regular text-text-quaternary">{apps.length}</span>
      </h2>
      {apps.length === 0 ? (
        <p className="rounded-[10px] bg-background-section p-3 text-center system-xs-regular text-text-tertiary">
          {t(($) => $['external.overview.emptyApps'])}
        </p>
      ) : (
        <ul className="divide-y divide-divider-subtle overflow-hidden rounded-xl border border-divider-regular">
          {apps.map((app) => (
            <li key={app.id ?? app.name}>
              <Link
                href="/apps"
                className="flex items-center gap-2.5 px-4 py-3 hover:bg-background-default-hover focus-visible:inset-ring-2 focus-visible:inset-ring-state-accent-solid"
              >
                <span
                  aria-hidden
                  className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-divider-regular bg-background-default text-xl"
                >
                  {app.kind === 'workflow' ? '🔄' : '💬'}
                </span>
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="system-md-semibold wrap-break-word text-text-primary">
                    {app.name}
                  </span>
                  <span className="system-xs-regular text-text-tertiary">
                    {app.kind === 'workflow'
                      ? t(($) => $['types.workflow'], { ns: 'app' })
                      : t(($) => $['types.advanced'], { ns: 'app' })}
                  </span>
                </span>
                <span
                  aria-hidden
                  className="i-ri-arrow-right-line size-4 shrink-0 text-text-tertiary rtl:rotate-180"
                />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
