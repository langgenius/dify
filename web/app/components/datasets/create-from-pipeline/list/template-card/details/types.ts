import type { ReactNode } from 'react'

export const EffectColor = {
  indigo: 'indigo',
  blueLight: 'blue-light',
  green: 'green',
  none: 'none',
} as const

export type EffectColor = (typeof EffectColor)[keyof typeof EffectColor]

export type Option = {
  icon: ReactNode
  title: string
  description?: string
  effectColor: EffectColor
}
