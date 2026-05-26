import type { ReactNode } from 'react'
import type { ChunkStructureEnum } from '../../../../nodes/knowledge-base/types'

export type Option = {
  id: ChunkStructureEnum
  icon: ReactNode | ((isActive: boolean) => ReactNode)
  title: string
  description: string
  effectColor?: string
}
