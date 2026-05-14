'use client'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { consoleQuery } from '@/service/client'
import { CreateReleaseControl } from './versions-tab/create-release-control'
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
  if (overview?.overview?.appInstance?.sourceAppAvailable !== false)
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
  const { t } = useTranslation('deployments')

  return (
    <div className="flex w-full flex-col gap-4 px-6 py-6">
      <div className="flex items-center justify-between gap-3">
        <div className="system-sm-semibold text-text-primary">
          {t('versions.releaseHistory')}
        </div>
        <CreateReleaseControl appInstanceId={appInstanceId} size="medium" />
      </div>

      <SourceAppUnavailableNotice appInstanceId={appInstanceId} />

      <ReleaseHistoryTable appInstanceId={appInstanceId} />
    </div>
  )
}
