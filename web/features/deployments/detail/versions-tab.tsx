'use client'
import { ReleaseHistoryTable } from './versions-tab/release-history-table'

export function VersionsTab({ appInstanceId }: {
  appInstanceId: string
}) {
  return (
    <div className="flex w-full min-w-0 flex-col gap-4 px-6 py-6">
      <ReleaseHistoryTable appInstanceId={appInstanceId} />
    </div>
  )
}
