import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import Link from '@/next/link'
import { consoleQuery } from '@/service/console'

export function ExternalAgentUsedInApps({ agentId }: { agentId: string }) {
  const { t } = useTranslation(['agentRoster', 'app'])
  const references = useQuery(
    consoleQuery.externalAgents.byAgentId.references.get.queryOptions({
      input: { params: { agent_id: agentId } },
    }),
  )
  const apps = references.data?.apps ?? []
  return (
    <section>
      <h2 className="flex items-center gap-2 pb-2 body-lg-regular leading-6 font-medium text-text-secondary">
        {t(($) => $['external.overview.usedInApps'])}
        {references.isSuccess && (
          <span className="system-sm-regular text-text-quaternary">{apps.length}</span>
        )}
      </h2>
      {references.isPending ? (
        <p role="status" className="py-3 system-xs-regular text-text-tertiary">
          {t(($) => $['external.api.loading'])}
        </p>
      ) : references.isError ? null : apps.length === 0 ? (
        <p className="rounded-[10px] bg-background-section p-3 text-center system-xs-regular text-text-tertiary">
          {t(($) => $['external.overview.emptyApps'])}
        </p>
      ) : (
        <ul className="divide-y divide-divider-subtle overflow-hidden rounded-xl border border-divider-regular">
          {apps.map((app) => (
            <li key={app.app_id}>
              <Link
                href={`/app/${encodeURIComponent(app.app_id)}/overview`}
                className="flex items-center gap-2.5 px-4 py-3 hover:bg-background-default-hover focus-visible:inset-ring-2 focus-visible:inset-ring-state-accent-solid"
              >
                <span
                  aria-hidden
                  className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-divider-regular bg-background-default text-xl"
                >
                  {app.mode === 'workflow' ? '🔄' : '💬'}
                </span>
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="system-md-semibold wrap-break-word text-text-primary">
                    {app.name}
                  </span>
                  <span className="system-xs-regular text-text-tertiary">
                    {app.mode === 'workflow'
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
