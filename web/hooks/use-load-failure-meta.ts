import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { toastRequestError } from '@/app/notifications/request-error'

/**
 * Query meta for content that has no error state of its own: a failed first load then toasts
 * instead of leaving the area blank.
 */
export function useLoadFailureMeta() {
  const { t } = useTranslation(['common'])
  return { errorMessage: t(($) => $['api.loadFailed'], { ns: 'common' }) }
}

/**
 * Toast a load failure that its caller only partly handles, such as a query whose 404 has a page
 * of its own. Pass the error only when nothing else on screen explains it.
 */
export function useLoadFailureToast(error: unknown) {
  const { errorMessage } = useLoadFailureMeta()
  useEffect(() => {
    if (error) toastRequestError(error, errorMessage)
  }, [error, errorMessage])
}
