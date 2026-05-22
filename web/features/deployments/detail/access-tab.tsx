'use client'

import { AccessChannelsSection } from './settings-tab/access/channels-section'
import { AccessPermissionsSection } from './settings-tab/access/permissions-section'

export function AccessTab({ appInstanceId }: {
  appInstanceId: string
}) {
  return (
    <div className="mx-auto flex w-full max-w-[1180px] min-w-0 flex-col gap-y-5 px-6 py-6 sm:py-8">
      <AccessPermissionsSection appInstanceId={appInstanceId} />
      <AccessChannelsSection appInstanceId={appInstanceId} />
    </div>
  )
}
