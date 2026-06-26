'use client'
import { ReleaseHistoryTable } from './release-history-table'

export function VersionsTab() {
  return (
    <div className="flex w-full min-w-0 flex-col gap-4 px-6 py-6">
      <ReleaseHistoryTable />
    </div>
  )
}
