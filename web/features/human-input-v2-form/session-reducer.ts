import type { HumanInputV2Challenge, HumanInputV2ErrorCategory } from './types'
import type { HumanInputFormDefinition } from '@/features/human-input-form/types'

export type HumanInputV2SessionPhase =
  | 'loading-form'
  | 'form-error'
  | 'requesting-otp'
  | 'access-error'
  | 'awaiting-otp'
  | 'challenge-expired'
  | 'submitting'
  | 'proof-error'
  | 'terminal'
  | 'success'

export type HumanInputV2SessionState = {
  phase: HumanInputV2SessionPhase
  definition?: HumanInputFormDefinition
  challenge?: HumanInputV2Challenge
  otpCode: string
  error?: HumanInputV2ErrorCategory
}

export type HumanInputV2SessionAction =
  | { type: 'reset' }
  | { type: 'form-loaded'; definition: HumanInputFormDefinition }
  | { type: 'form-failed'; error: HumanInputV2ErrorCategory; terminal: boolean }
  | { type: 'access-requested' }
  | { type: 'access-succeeded'; challenge: HumanInputV2Challenge }
  | { type: 'access-failed'; error: HumanInputV2ErrorCategory; preserveChallenge: boolean }
  | { type: 'otp-changed'; otpCode: string }
  | { type: 'challenge-expired' }
  | { type: 'submit-requested' }
  | { type: 'submit-proof-failed'; error: HumanInputV2ErrorCategory }
  | { type: 'submit-challenge-failed'; error: HumanInputV2ErrorCategory }
  | { type: 'submit-terminal-failed'; error: HumanInputV2ErrorCategory }
  | { type: 'submit-succeeded' }

export const initialHumanInputV2SessionState: HumanInputV2SessionState = {
  phase: 'loading-form',
  otpCode: '',
}

export const humanInputV2SessionReducer = (
  state: HumanInputV2SessionState,
  action: HumanInputV2SessionAction,
): HumanInputV2SessionState => {
  switch (action.type) {
    case 'reset':
      return initialHumanInputV2SessionState
    case 'form-loaded':
      return {
        phase: 'requesting-otp',
        definition: action.definition,
        otpCode: '',
      }
    case 'form-failed':
      return {
        phase: action.terminal ? 'terminal' : 'form-error',
        otpCode: '',
        error: action.error,
      }
    case 'access-requested':
      return {
        ...state,
        phase: 'requesting-otp',
        error: undefined,
      }
    case 'access-succeeded':
      return {
        ...state,
        phase: 'awaiting-otp',
        challenge: action.challenge,
        otpCode: '',
        error: undefined,
      }
    case 'access-failed':
      return {
        ...state,
        phase: action.preserveChallenge ? 'awaiting-otp' : 'access-error',
        challenge: action.preserveChallenge ? state.challenge : undefined,
        error: action.error,
      }
    case 'otp-changed':
      return {
        ...state,
        phase: state.challenge ? 'awaiting-otp' : state.phase,
        otpCode: action.otpCode,
        error: undefined,
      }
    case 'challenge-expired':
      return {
        ...state,
        phase: 'challenge-expired',
        challenge: undefined,
        otpCode: '',
        error: 'challenge-expired',
      }
    case 'submit-requested':
      return {
        ...state,
        phase: 'submitting',
        error: undefined,
      }
    case 'submit-proof-failed':
      return {
        ...state,
        phase: 'proof-error',
        error: action.error,
      }
    case 'submit-challenge-failed':
      return {
        ...state,
        phase: 'challenge-expired',
        challenge: undefined,
        otpCode: '',
        error: action.error,
      }
    case 'submit-terminal-failed':
      return {
        phase: 'terminal',
        definition: state.definition,
        otpCode: '',
        error: action.error,
      }
    case 'submit-succeeded':
      return {
        phase: 'success',
        definition: state.definition,
        otpCode: '',
      }
  }
}
