import type {
  ParametersSchema,
  PluginDeclaration,
  PluginDetail,
  PluginTriggerSubscriptionConstructor,
} from '../types'
import { create } from 'zustand'

type TriggerDeclarationSummary = {
  subscription_schema?: ParametersSchema[]
  subscription_constructor?: PluginTriggerSubscriptionConstructor | null
}

export type SimpleDetail = Pick<PluginDetail, 'plugin_id' | 'name' | 'plugin_unique_identifier' | 'id'> & {
  provider: string
  declaration: Partial<Omit<PluginDeclaration, 'trigger'>> & {
    trigger?: TriggerDeclarationSummary
  }
}

type Shape = {
  detail: SimpleDetail | undefined
  setDetail: (detail?: SimpleDetail) => void
}

export const usePluginStore = create<Shape>(set => ({
  detail: undefined,
  setDetail: (detail?: SimpleDetail) => set({ detail }),
}))
