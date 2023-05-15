import { useState, useCallback } from 'react'
import debounce from 'lodash-es/debounce'
import { DebouncedFunc } from 'lodash-es'
import { validateProviderKey } from '@/service/common'

export enum ValidatedStatus {
  Success = 'success',
  Error = 'error',
  Exceed = 'exceed'
}

const useValidateToken = (providerName: string): [boolean, ValidatedStatus | undefined, DebouncedFunc<(token: string) => Promise<void>>] => {
  const [validating, setValidating] = useState(false)
  const [validatedStatus, setValidatedStatus] = useState<ValidatedStatus | undefined>()
  const validate = useCallback(debounce(async (token: string) => {
    if (!token) {
      setValidatedStatus(undefined)
      return
    }
    setValidating(true)
    try {
      const res = await validateProviderKey({ url: `/workspaces/current/providers/${providerName}/token-validate`, body: { token } })
      setValidatedStatus(res.result === 'success' ? ValidatedStatus.Success : ValidatedStatus.Error)
    } catch (e: any) {
      if (e.status === 400) {
        e.json().then(({ code }: any) => {
          if (code === 'provider_request_failed') {
            setValidatedStatus(ValidatedStatus.Exceed)
          }
        })
      } else {
        setValidatedStatus(ValidatedStatus.Error)
      }
    } finally {
      setValidating(false)
    }
  }, 500), [])

  return [
    validating,
    validatedStatus,
    validate,
  ]
}

export default useValidateToken