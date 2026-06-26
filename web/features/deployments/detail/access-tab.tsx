'use client'

import { useAtomValue } from 'jotai'
import { AccessChannelsSection } from './settings-tab/access/channels-section'
import { AccessPermissionsSection } from './settings-tab/access/permissions-section'
import { accessSettingsQueryAtom } from './settings-tab/access/state'

export function AccessTab({ appInstanceId }: {
  appInstanceId: string
}) {
  const accessSettingsQuery = useAtomValue(accessSettingsQueryAtom)

  return (
    <div className="flex w-full max-w-[960px] min-w-0 flex-col gap-y-4 px-6 py-6 sm:px-20 sm:py-8">
      <AccessChannelsSection
        appInstanceId={appInstanceId}
        accessChannels={accessSettingsQuery.data?.accessChannels}
        webAppEndpoints={accessSettingsQuery.data?.webAppEndpoints}
        cliEndpoint={accessSettingsQuery.data?.cliEndpoint}
        isLoading={accessSettingsQuery.isLoading}
        isError={accessSettingsQuery.isError}
      />
      <AccessPermissionsSection
        appInstanceId={appInstanceId}
        environmentPolicies={accessSettingsQuery.data?.environmentPolicies}
        isLoading={accessSettingsQuery.isLoading}
        isError={accessSettingsQuery.isError}
      />
    </div>
  )
}
