import type { ReactNode } from 'react'

export type Option = {
  key: string
  icon: ReactNode
  title: string
  description: string
  effectColor?: string
  showEffectColor?: boolean,
}
