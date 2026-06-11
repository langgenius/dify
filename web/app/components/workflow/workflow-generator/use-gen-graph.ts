import type { GenerateWorkflowResponse } from './types'
import { useSessionStorageState } from 'ahooks'
import { useCallback } from 'react'

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

  const addVersion = useCallback((version: GenerateWorkflowResponse) => {
    // Compute the next list once so the selected index always points at the
    // entry we just appended — even when the cap drops the oldest version
    // (the old length-based index would then be off by one).
    const next = [...(versions ?? []), version].slice(-MAX_VERSIONS)
    setVersions(next)
    setCurrentVersionIndex(next.length - 1)
  }, [setVersions, setCurrentVersionIndex, versions])

  return {
    versions,
    addVersion,
    currentVersionIndex: safeIndex,
    setCurrentVersionIndex,
    current,
  }
}

export default useGenGraph
