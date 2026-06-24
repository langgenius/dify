export const ValidatedStatus = {
  Success: 'success',
  Error: 'error',
  Exceed: 'exceed',
} as const

export type ValidatedStatus = typeof ValidatedStatus[keyof typeof ValidatedStatus]
