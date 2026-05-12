import type { GenerateWorkflowResponse } from './types'
import { useSessionStorageState } from 'ahooks'
import { useCallback } from 'react'

const KEY_PREFIX = 'workflow-gen-'

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

  const current = versions?.[currentVersionIndex ?? 0]

  const addVersion = useCallback((version: GenerateWorkflowResponse) => {
    setCurrentVersionIndex(() => versions?.length || 0)
    setVersions(prev => [...(prev ?? []), version])
  }, [setVersions, setCurrentVersionIndex, versions?.length])

  return {
    versions,
    addVersion,
    currentVersionIndex,
    setCurrentVersionIndex,
    current,
  }
}

export default useGenGraph
