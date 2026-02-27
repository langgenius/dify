import type { ComponentType } from 'react'
import type {
  HybridSearchModeEnum,
  RetrievalSearchMethodEnum,
} from '../../types'

export type Option = {
  id: RetrievalSearchMethodEnum
  icon: ComponentType<any>
  title: any
  description: string
  effectColor?: string
  showEffectColor?: boolean
}

export type HybridSearchModeOption = {
  id: HybridSearchModeEnum
  title: string
  description: string
}
