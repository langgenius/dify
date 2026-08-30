'use client'

import type {
  DifyBuilderChecklistErrorPayload,
  DifyBuilderModelConfigPayload,
} from '@dify/contracts/api/console/dify-builder/types.gen'
import type { zDifyBuilderSessionViewResponse } from '@dify/contracts/api/console/dify-builder/zod.gen'
import type { z } from 'zod'
import { createContext, use } from 'react'

export type DifyBuilderSessionView = z.output<typeof zDifyBuilderSessionViewResponse>

export type DifyBuilderFixTarget =
  | { failedRunId: string }
  | { checklistErrors: DifyBuilderChecklistErrorPayload[] }

export type DifyBuilderContextValue = {
  view: DifyBuilderSessionView | null
  error: string
  isBusy: boolean
  selectedModel: DifyBuilderModelConfigPayload | null
  setSelectedModel: (model: DifyBuilderModelConfigPayload | null) => void
  startPrompt: (text: string, fixTarget?: DifyBuilderFixTarget) => Promise<boolean>
  submitAction: (actionId: string, payload?: Record<string, unknown>) => Promise<boolean>
  updateModel: (model: DifyBuilderModelConfigPayload) => Promise<boolean>
  reset: () => void
}

export const DifyBuilderContext = createContext<DifyBuilderContextValue | null>(null)

export const useDifyBuilder = () => {
  const value = use(DifyBuilderContext)
  if (!value) throw new Error('useDifyBuilder must be used inside DifyBuilderProvider')
  return value
}
