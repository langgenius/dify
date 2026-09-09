'use client'

import { useCallback, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from '@/next/navigation'

export const CONTACT_IM_SYNC_RUN_QUERY_PARAM = 'sync_run_id'

export const useContactImSyncRunUrlState = () => {
  const pathname = usePathname()
  const router = useRouter()
  const searchParams = useSearchParams()
  const serializedSearchParams = searchParams.toString()
  const [runId, setRunId] = useState<string | null>(() =>
    searchParams.has(CONTACT_IM_SYNC_RUN_QUERY_PARAM) ? 'latest' : null,
  )

  const updateRunId = useCallback(
    (nextRunId: string | null) => {
      const nextSearchParams = new URLSearchParams(serializedSearchParams)

      if (nextRunId) nextSearchParams.set(CONTACT_IM_SYNC_RUN_QUERY_PARAM, 'latest')
      else nextSearchParams.delete(CONTACT_IM_SYNC_RUN_QUERY_PARAM)

      setRunId(nextRunId ? 'latest' : null)
      const query = nextSearchParams.toString()
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false })
    },
    [pathname, router, serializedSearchParams],
  )

  return [runId, updateRunId] as const
}
