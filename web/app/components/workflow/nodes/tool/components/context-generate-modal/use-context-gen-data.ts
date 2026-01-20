import type { ContextGenerateResponse } from '@/service/debug'
import { useSessionStorageState } from 'ahooks'
import { useCallback } from 'react'

type Params = {
  storageKey: string
}

const keyPrefix = 'context-gen-'

const useContextGenData = ({ storageKey }: Params) => {
  const [versions, setVersions] = useSessionStorageState<ContextGenerateResponse[]>(`${keyPrefix}${storageKey}-versions`, {
    defaultValue: [],
  })

  const [currentVersionIndex, setCurrentVersionIndex] = useSessionStorageState<number>(`${keyPrefix}${storageKey}-version-index`, {
    defaultValue: 0,
  })

  const current = versions?.[currentVersionIndex || 0]

  const addVersion = useCallback((version: ContextGenerateResponse) => {
    setCurrentVersionIndex(() => versions?.length || 0)
    setVersions((prev) => {
      return [...(prev || []), version]
    })
  }, [setCurrentVersionIndex, setVersions, versions?.length])

  return {
    versions,
    addVersion,
    currentVersionIndex,
    setCurrentVersionIndex,
    current,
  }
}

export default useContextGenData
