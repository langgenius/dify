import type { Dispatch, SetStateAction } from 'react'
import { useCallback, useState } from 'react'
import debounce from 'lodash-es/debounce'
import type { DebouncedFunc } from 'lodash-es'
import { validateProviderKey } from '@/service/common'

export enum ValidatedStatus {
  Success = 'success',
  Error = 'error',
  Exceed = 'exceed',
}
export type ValidatedStatusState = {
  status?: ValidatedStatus
  message?: string
}
// export type ValidatedStatusState = ValidatedStatus | undefined | ValidatedError
export type SetValidatedStatus = Dispatch<SetStateAction<ValidatedStatusState>>
export type ValidateFn = DebouncedFunc<(token: any, config: ValidateFnConfig) => void>
type ValidateTokenReturn = [
  boolean,
  ValidatedStatusState,
  SetValidatedStatus,
  ValidateFn,
]
export type ValidateFnConfig = {
  beforeValidating: (token: any) => boolean
}

const useValidateToken = (providerName: string): ValidateTokenReturn => {
  const [validating, setValidating] = useState(false)
  const [validatedStatus, setValidatedStatus] = useState<ValidatedStatusState>({})
  const validate = useCallback(debounce(async (token: string, config: ValidateFnConfig) => {
    if (!config.beforeValidating(token))
      return false

    setValidating(true)
    try {
      const res = await validateProviderKey({ url: `/workspaces/current/providers/${providerName}/token-validate`, body: { token } })
      setValidatedStatus(
        res.result === 'success'
          ? { status: ValidatedStatus.Success }
          : { status: ValidatedStatus.Error, message: res.error })
    }
    catch (e: any) {
      setValidatedStatus({ status: ValidatedStatus.Error, message: e.message })
    }
    finally {
      setValidating(false)
    }
  }, 500), [])

  return [
    validating,
    validatedStatus,
    setValidatedStatus,
    validate,
  ]
}

export default useValidateToken
