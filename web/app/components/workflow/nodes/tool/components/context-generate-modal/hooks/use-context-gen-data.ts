import type { ContextGenerateResponse } from '@/service/debug'
import { useSessionStorageState } from 'ahooks'
import { useCallback } from 'react'
import { CONTEXT_GEN_STORAGE_SUFFIX, getContextGenStorageKey } from '../utils/storage'

type Params = {
  storageKey: string
}

const useContextGenData = ({ storageKey }: Params) => {
  const [versions, setVersions] = useSessionStorageState<ContextGenerateResponse[]>(
    getContextGenStorageKey(storageKey, CONTEXT_GEN_STORAGE_SUFFIX.versions),
    {
      defaultValue: [],
    },
  )

  const [currentVersionIndex, setCurrentVersionIndex] = useSessionStorageState<number>(
    getContextGenStorageKey(storageKey, CONTEXT_GEN_STORAGE_SUFFIX.versionIndex),
    {
      defaultValue: 0,
    },
  )

  const current = versions?.[currentVersionIndex || 0]

  const addVersion = useCallback((version: ContextGenerateResponse) => {
    setCurrentVersionIndex(() => versions?.length || 0)
    setVersions((prev) => {
      return [...(prev || []), version]
    })
  }, [setCurrentVersionIndex, setVersions, versions?.length])

  const clearVersions = useCallback(() => {
    setVersions([])
    setCurrentVersionIndex(0)
  }, [setCurrentVersionIndex, setVersions])

  return {
    versions,
    addVersion,
    clearVersions,
    currentVersionIndex,
    setCurrentVersionIndex,
    current,
  }
}

export default useContextGenData
