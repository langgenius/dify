'use client'

import { useQuery } from '@tanstack/react-query'
import { consoleQuery } from '@/service/client'
import { AccessChannelsSection } from './settings-tab/access/channels-section'
import { AccessPermissionsSection } from './settings-tab/access/permissions-section'

export function AccessTab({ appInstanceId }: {
  appInstanceId: string
}) {
  const accessSettingsQuery = useQuery(consoleQuery.enterprise.accessService.getAccessSettings.queryOptions({
    input: {
      params: { appInstanceId },
    },
  }))

  return (
    <div className="flex w-full min-w-0 flex-col gap-y-5 px-6 py-6 sm:py-8">
      <AccessPermissionsSection
        appInstanceId={appInstanceId}
        accessChannels={accessSettingsQuery.data?.accessChannels}
        environmentPolicies={accessSettingsQuery.data?.environmentPolicies}
        isLoading={accessSettingsQuery.isLoading}
        isError={accessSettingsQuery.isError}
      />
      <AccessChannelsSection
        appInstanceId={appInstanceId}
        accessChannels={accessSettingsQuery.data?.accessChannels}
        webAppEndpoints={accessSettingsQuery.data?.webAppEndpoints}
        cliEndpoint={accessSettingsQuery.data?.cliEndpoint}
        isLoading={accessSettingsQuery.isLoading}
        isError={accessSettingsQuery.isError}
      />
    </div>
  )
}
