import { useCallback, useEffect, useEffectEvent, useState } from 'react'
import { runDraftInitialization } from '../collaboration/core/collaboration-manager'

export type ModelChangeSource = 'default' | 'user'

export function useModelChangeWithVision<T extends Record<string, unknown>>(
  setInputs: (inputs: T) => void,
  updateVision: () => void,
) {
  const [selection, setSelection] = useState<{ source: ModelChangeSource }>()
  const syncVision = useEffectEvent((source: ModelChangeSource) => {
    if (source === 'default') runDraftInitialization(updateVision)
    else updateVision()
  })
  useEffect(() => {
    if (selection) syncVision(selection.source)
  }, [selection])

  return useCallback(
    (before: T, after: T, source: ModelChangeSource = 'user') => {
      if (source === 'default') runDraftInitialization(() => setInputs(after), before)
      else setInputs(after)
      setSelection({ source })
    },
    [setInputs],
  )
}
