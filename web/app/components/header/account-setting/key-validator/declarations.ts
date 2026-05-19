import type { Dispatch, SetStateAction } from 'react'

export const ValidatedStatus = {
  Success: 'success',
  Error: 'error',
  Exceed: 'exceed',
} as const

export type ValidatedStatus = typeof ValidatedStatus[keyof typeof ValidatedStatus]

export type ValidatedStatusState = {
  status?: ValidatedStatus
  message?: string
}

export type Status = 'add' | 'fail' | 'success'

export type ValidateValue = Record<string, any>

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
