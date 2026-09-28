import type { HybridSearchModeEnum, RetrievalSearchMethodEnum } from '../../types'

export type Option = {
  id: RetrievalSearchMethodEnum
  iconClassName: string
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
