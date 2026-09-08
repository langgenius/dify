'use client'

import type {
  ModelProviderPluginSummaryResponse,
  ModelProviderSummaryResponse,
} from '@dify/contracts/api/console/workspaces/types.gen'
import { createContext, useContext, useContextSelector } from 'use-context-selector'

export type ProviderContextState = {
  modelProviders: ModelProviderSummaryResponse[]
  modelProviderPlugins: Record<string, ModelProviderPluginSummaryResponse>
  isLoadingModelProviders: boolean
  isSuccessModelProviders: boolean
  refreshModelProviders: () => Promise<void>
}

const baseProviderContextValue: ProviderContextState = {
  modelProviders: [],
  modelProviderPlugins: {},
  isLoadingModelProviders: false,
  isSuccessModelProviders: false,
  refreshModelProviders: async () => {},
}

export const ProviderContext = createContext<ProviderContextState>(baseProviderContextValue)

export const useProviderContext = () => useContext(ProviderContext)

// Adding a dangling comma to avoid the generic parsing issue in tsx, see:
// https://github.com/microsoft/TypeScript/issues/15713
export const useProviderContextSelector = <T>(selector: (state: ProviderContextState) => T): T =>
  useContextSelector(ProviderContext, selector)
