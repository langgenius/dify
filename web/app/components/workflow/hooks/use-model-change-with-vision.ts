import type { ModelConfig } from '../types'
import type { VisionConfig } from './use-config-vision'
import { useCallback } from 'react'
import { runDraftInitialization } from '../collaboration/core/collaboration-manager'

export type ModelChangeSource = 'default' | 'user'

export function useModelChangeWithVision<
  T extends Record<string, unknown> & { model: ModelConfig; vision: VisionConfig },
>(
  setInputs: (inputs: T) => void,
  getVisionAfterModelChange: (model: ModelConfig, vision: VisionConfig) => VisionConfig,
) {
  return useCallback(
    (before: T, after: T, source: ModelChangeSource = 'user') => {
      const next = {
        ...after,
        vision: getVisionAfterModelChange(after.model, after.vision),
      }
      if (source === 'default') runDraftInitialization(() => setInputs(next), before)
      else setInputs(next)
    },
    [getVisionAfterModelChange, setInputs],
  )
}
