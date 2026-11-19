import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { LoadingPlaceholder } from '@/app/components/base/loading-placeholder'
import Link from '@/next/link'
import { consoleQuery } from '@/service/console'

export function EditConnectionApps({ agentId }: { agentId: string }) {
  const { t } = useTranslation(['agentRoster'])
  const references = useQuery(
    consoleQuery.externalAgents.byAgentId.references.get.queryOptions({
      input: { params: { agent_id: agentId } },
      context: { silent: true },
    }),
  )
  if (references.isPending) return <LoadingPlaceholder className="h-12" />
  const apps = references.data?.apps
  if (references.isError || !apps?.length) return null
  return (
    <div className="flex items-start gap-2">
      <span aria-hidden className="mt-0.5 i-ri-apps-line size-4 shrink-0 text-text-tertiary" />
      <div className="min-w-0">
        <h3 className="system-sm-medium text-text-primary">
          {t(($) => $['external.connection.affectedApps'], { count: apps.length })}
        </h3>
        <p className="mt-0.5 system-xs-regular wrap-break-word text-text-tertiary">
          {apps.map((app, index) => (
            <span key={app.app_id}>
              {index > 0 ? ', ' : null}
              <Link
                href={`/app/${encodeURIComponent(app.app_id)}/overview`}
                className="rounded-sm hover:text-text-secondary hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-state-accent-solid"
              >
                {app.name}
              </Link>
            </span>
          ))}
        </p>
      </div>
    </div>
  )
}
