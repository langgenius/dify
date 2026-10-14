import { useTranslation } from 'react-i18next'

/**
 * Query meta for content that has no error state of its own: a failed first load then toasts
 * instead of leaving the area blank.
 */
export function useLoadFailureMeta() {
  const { t } = useTranslation(['common'])
  return { errorMessage: t(($) => $['api.loadFailed'], { ns: 'common' }) }
}
