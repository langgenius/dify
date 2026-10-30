'use client'

import type { ImSyncResultItem } from '@dify/contracts/api/console/workspaces/types.gen'
import { parseAsString, parseAsStringEnum, useQueryState } from 'nuqs'

type SyncResult = ImSyncResultItem['result']['type']
export const useContactImSyncRunUrlState = () =>
  useQueryState('sync_run_id', parseAsString.withOptions({ history: 'push' }))

export const useContactImSyncResultUrlState = () =>
  useQueryState(
    'sync_result',
    parseAsStringEnum<SyncResult>([
      'added',
      'not_matched',
      'failed',
      'removed',
      'skipped',
    ]).withDefault('added'),
  )
