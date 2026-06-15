import type { GenerateWorkflowResponse } from './types'
import { useSessionStorageState } from 'ahooks'
import { useCallback, useEffect, useRef } from 'react'

const KEY_PREFIX = 'workflow-gen-'

// Upper bound on retained generations. Each version embeds a full graph
// (tens of KB for a large refine), and sessionStorage offers ~5MB for the
// whole origin — an unbounded history can hit the quota mid-session and
// silently stop persisting. Ten comfortably covers "compare a few attempts".
const MAX_VERSIONS = 10

type Params = {
  storageKey: string
}

/**
 * Session-storage-backed version history for generated workflows.
 *
 * Mirrors ``app/configuration/config/automatic/use-gen-data.ts`` so the
 * cmd+k workflow generator's UX (left pane edit → Generate → right pane
 * version selector) matches the existing Prompt Generator.
 */
const useGenGraph = ({ storageKey }: Params) => {
  const [versions, setVersions] = useSessionStorageState<GenerateWorkflowResponse[]>(
    `${KEY_PREFIX}${storageKey}-versions`,
    { defaultValue: [] },
  )

  const [currentVersionIndex, setCurrentVersionIndex] = useSessionStorageState<number>(
    `${KEY_PREFIX}${storageKey}-version-index`,
    { defaultValue: 0 },
  )

  // Clamp the persisted index into bounds — sessionStorage can hold an index
  // from a longer, since-capped history (or one cleared by another tab).
  const safeIndex = Math.min(currentVersionIndex ?? 0, Math.max((versions?.length ?? 0) - 1, 0))
  const current = versions?.[safeIndex]

  // Version count including adds React hasn't committed yet. addVersion can
  // run twice inside one batch (the functional setVersions appends both), so
  // the selected-index math must not read `versions` from the render closure
  // — it would be one add behind and select the wrong entry.
  const versionCountRef = useRef(versions?.length ?? 0)
  useEffect(() => {
    versionCountRef.current = versions?.length ?? 0
  }, [versions])

  const addVersion = useCallback((version: GenerateWorkflowResponse) => {
    const nextCount = Math.min(versionCountRef.current + 1, MAX_VERSIONS)
    versionCountRef.current = nextCount
    // Functional update so batched adds append instead of clobbering each
    // other; the slice keeps the retained history under the cap.
    setVersions(prev => [...(prev ?? []), version].slice(-MAX_VERSIONS))
    setCurrentVersionIndex(nextCount - 1)
  }, [setVersions, setCurrentVersionIndex])

  return {
    versions,
    addVersion,
    currentVersionIndex: safeIndex,
    setCurrentVersionIndex,
    current,
  }
}

export default useGenGraph
