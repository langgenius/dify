'use client'

import { isCancelledError } from '@tanstack/react-query'
import { getI18n } from 'react-i18next'
import { getErrorMessage } from '@/utils/error-message'
import { toast } from './index'

/** Business error feedback; transports must only propagate failures. */
export function notifyError(error: unknown) {
  if (
    isCancelledError(error) ||
    (error instanceof Error &&
      (error.name === 'AbortError' || /^AbortError(?::|$)/.test(error.message)))
  )
    return
  toast.error(getErrorMessage(error) ?? getI18n().t(($) => $['api.actionFailed'], { ns: 'common' }))
}
