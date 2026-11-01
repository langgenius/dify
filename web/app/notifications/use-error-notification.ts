'use client'

import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { getErrorMessage } from '@/utils/error-message'
import { toast } from '.'

/** Opt in at an interaction boundary when its failure cannot be presented inline. */
export function useErrorNotification() {
  const { t } = useTranslation(['common'])
  return useCallback(
    (error: unknown) => {
      if (error instanceof Error && error.name === 'AbortError') return
      toast.error(getErrorMessage(error) ?? t(($) => $['api.actionFailed']))
    },
    [t],
  )
}
