import type { ReactNode } from 'react'

export enum EffectColor {
  indigo = 'indigo',
  blueLight = 'blue-light',
  green = 'green',
  none = 'none',
}

export type Option = {
  icon: ReactNode
  title: string
  description?: string
  effectColor: EffectColor
}
