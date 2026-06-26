'use client'

import { AccessChannelsSection } from './settings-tab/access/channels-section'
import { AccessPermissionsSection } from './settings-tab/access/permissions-section'

export function AccessTab() {
  return (
    <div className="flex w-full max-w-[960px] min-w-0 flex-col gap-y-4 px-6 py-6 sm:px-20 sm:py-8">
      <AccessChannelsSection />
      <AccessPermissionsSection />
    </div>
  )
}
