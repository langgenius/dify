import type { ReactNode } from 'react'
import type { ConfigParams } from '../settings'
import type { AppDetailResponse } from '@/models/app'
import type { AppSSO } from '@/types/app'

export type AppCardType = 'api' | 'webapp'

export type IAppCardProps = {
  className?: string
  appInfo: AppDetailResponse & Partial<AppSSO>
  isInPanel?: boolean
  cardType?: AppCardType
  customBgColor?: string
  triggerModeDisabled?: boolean
  triggerModeMessage?: ReactNode
  onChangeStatus: (val: boolean) => Promise<void>
  onSaveSiteConfig?: (params: ConfigParams) => Promise<void>
  onGenerateCode?: () => Promise<void>
}
