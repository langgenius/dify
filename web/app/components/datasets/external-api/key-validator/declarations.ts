import type { Dispatch, SetStateAction } from 'react'

export enum ValidatedApiKeyStatus {
  Success = 'success',
  Error = 'error',
}

export type ValidatedStatusState = {
  status?: ValidatedApiKeyStatus
  message?: string
}

export type Status = 'add' | 'fail' | 'success'

export type ValidateValue = string

export type ValidateCallback = {
  before: (v?: ValidateValue) => boolean | undefined
  run?: (v?: ValidateValue) => Promise<ValidatedStatusState>
}

export type Form = {
  key: string
  title: string
  placeholder: string
  value?: string
  validate?: ValidateCallback
  handleFocus?: (v: ValidateValue, dispatch: Dispatch<SetStateAction<ValidateValue>>) => void
}

export type KeyFrom = {
  text: string
  link: string
}

export type KeyValidatorProps = {
  type: string
  title: React.ReactNode
  status: Status
  forms: Form[]
  keyFrom: KeyFrom
}
