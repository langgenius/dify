'use client'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { consoleQuery } from '@/service/client'
import { useSourceAppAvailability } from './source-app-availability'
import { ReleaseHistoryTable } from './versions-tab/release-history-table'

function SourceAppUnavailableNotice({ appInstanceId }: {
  appInstanceId: string
}) {
  const { t } = useTranslation('deployments')
  const { data: overview } = useQuery(consoleQuery.enterprise.appInstanceService.getAppInstanceOverview.queryOptions({
    input: {
      params: { appInstanceId },
    },
  }))
  const sourceAppAvailability = useSourceAppAvailability(overview?.overview?.appInstance)
  if (!sourceAppAvailability.sourceAppUnavailable)
    return null

  return (
    <div className="rounded-lg border border-divider-subtle bg-background-default-subtle px-3 py-2 system-sm-regular text-text-tertiary">
      {t('versions.sourceAppUnavailable')}
    </div>
  )
}

export function VersionsTab({ appInstanceId }: {
  appInstanceId: string
}) {
  return (
    <div className="flex w-full min-w-0 flex-col gap-4 px-6 py-6">
      <SourceAppUnavailableNotice appInstanceId={appInstanceId} />

      <ReleaseHistoryTable appInstanceId={appInstanceId} />
    </div>
  )
}
