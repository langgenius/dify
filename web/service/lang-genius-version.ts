import type { LangGeniusVersionResponse } from '@/models/common'
import { queryOptions } from '@tanstack/react-query'
// eslint-disable-next-line no-restricted-imports
import { get } from './base'
import { commonQueryKeys } from './use-common'

export const langGeniusVersionQueryOptions = (currentVersion?: string | null, enabled?: boolean) => {
  return queryOptions<LangGeniusVersionResponse>({
    queryKey: commonQueryKeys.langGeniusVersion(currentVersion || undefined),
    queryFn: () => get<LangGeniusVersionResponse>('/version', { params: { current_version: currentVersion } }),
    enabled: !!currentVersion && (enabled ?? true),
  })
}
