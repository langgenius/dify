import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { describeRequestError } from './request-error-message'

/**
 * Describes failed requests where one hook call cannot, such as several errors in one owner:
 * `describe(error, fallback)` follows the order of `resolveRequestErrorMessage`. It keeps its
 * identity while the language does, so it can be a hook dependency.
 */
export function useRequestErrorDescriber() {
  const { t } = useTranslation(['requestErrors'])
  return useCallback(
    (error: unknown, fallback?: string) => describeRequestError(error, { t, fallback }),
    [t],
  )
}
