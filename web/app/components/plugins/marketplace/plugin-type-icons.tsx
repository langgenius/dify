import type { ComponentType } from 'react'
import {
  RiBrain2Line,
  RiDatabase2Line,
  RiHammerLine,
  RiPuzzle2Line,
  RiSpeakAiLine,
} from '@remixicon/react'
import { Trigger as TriggerIcon } from '@/app/components/base/icons/src/vender/plugin'
import { PluginCategoryEnum } from '../types'

export type PluginTypeIconComponent = ComponentType<{ className?: string }>

export const MARKETPLACE_TYPE_ICON_COMPONENTS: Record<PluginCategoryEnum, PluginTypeIconComponent> = {
  [PluginCategoryEnum.tool]: RiHammerLine,
  [PluginCategoryEnum.model]: RiBrain2Line,
  [PluginCategoryEnum.datasource]: RiDatabase2Line,
  [PluginCategoryEnum.trigger]: TriggerIcon,
  [PluginCategoryEnum.agent]: RiSpeakAiLine,
  [PluginCategoryEnum.extension]: RiPuzzle2Line,
}
