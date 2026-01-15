import type { ChunkingMode } from '@/models/datasets'

export enum EffectColor {
  indigo = 'indigo',
  blueLight = 'blue-light',
  orange = 'orange',
  purple = 'purple',
}

export type Option = {
  id: ChunkingMode
  icon?: React.ReactNode
  iconActiveColor?: string
  title: string
  description?: string
  effectColor?: EffectColor
  showEffectColor?: boolean
}
