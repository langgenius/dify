'use client'

import { DeveloperApiSection } from './settings-tab/access/developer-api-section'

export function DeveloperApiTab({ appInstanceId }: {
  appInstanceId: string
}) {
  return (
    <div className="flex w-full min-w-0 flex-col gap-y-5 px-6 py-6 sm:py-8">
      <DeveloperApiSection appInstanceId={appInstanceId} />
    </div>
  )
}
