export const NULL_STRATEGY = {
  RAISE_ERROR: 'raise_error',
  USE_DEFAULT: 'use_default',
} as const

export type NullStrategy = typeof NULL_STRATEGY[keyof typeof NULL_STRATEGY]
