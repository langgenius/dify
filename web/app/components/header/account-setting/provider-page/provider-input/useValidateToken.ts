import { useState, useCallback, SetStateAction, Dispatch } from 'react'
import debounce from 'lodash-es/debounce'
import { DebouncedFunc } from 'lodash-es'
import { validateProviderKey } from '@/service/common'

export enum ValidatedStatus {
  Success = 'success',
  Error = 'error',
  Exceed = 'exceed'
}
export type SetValidatedStatus = Dispatch<SetStateAction<ValidatedStatus | undefined>>
export type ValidateFn = DebouncedFunc<(token: any, config: ValidateFnConfig) => void>
type ValidateTokenReturn = [
  boolean, 
  ValidatedStatus | undefined, 
  SetValidatedStatus,
  ValidateFn
]
export type ValidateFnConfig = {
  beforeValidating: (token: any) => boolean
}

const useValidateToken = (providerName: string): ValidateTokenReturn => {
  const [validating, setValidating] = useState(false)
  const [validatedStatus, setValidatedStatus] = useState<ValidatedStatus | undefined>()
  const validate = useCallback(debounce(async (token: string, config: ValidateFnConfig) => {
    if (!config.beforeValidating(token)) {
      return false
    }
    setValidating(true)
    try {
      const res = await validateProviderKey({ url: `/workspaces/current/providers/${providerName}/token-validate`, body: { token } })
      setValidatedStatus(res.result === 'success' ? ValidatedStatus.Success : ValidatedStatus.Error)
    } catch (e: any) {
      if (e.status === 400) {
        e.json().then(({ code }: any) => {
          if (code === 'provider_request_failed' && providerName === 'openai') {
            setValidatedStatus(ValidatedStatus.Exceed)
          } else {
            setValidatedStatus(ValidatedStatus.Error)
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
    setValidatedStatus,
    validate
  ]
}

export default useValidateToken