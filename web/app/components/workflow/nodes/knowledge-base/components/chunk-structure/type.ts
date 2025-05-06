import type { ReactNode } from 'react'
import type { ChunkStructureEnum } from '../../types'

export type Option = {
  id: ChunkStructureEnum
  icon: ReactNode
  title: string
  description: string
  effectColor?: string
  showEffectColor?: boolean,
}
