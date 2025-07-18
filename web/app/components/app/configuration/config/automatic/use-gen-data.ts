import type { GenRes } from '@/service/debug'
import { useSessionStorageState } from 'ahooks'
import { useCallback } from 'react'

type Params = {
  storageKey: string
}
const keyPrefix = 'gen-data-'
const useGenData = ({ storageKey }: Params) => {
  const [versions, setVersions] = useSessionStorageState<GenRes[]>(`${keyPrefix}${storageKey}-versions`, {
    defaultValue: [],
  })

  const [currentVersionIndex, setCurrentVersionIndex] = useSessionStorageState<number>(`${keyPrefix}${storageKey}-version-index`, {
    defaultValue: 0,
  })

  const current = versions[currentVersionIndex]

  const addVersion = useCallback((version: GenRes) => {
    setCurrentVersionIndex(() => versions.length)
    setVersions((prev) => {
      return [...prev!, version]
    })
  }, [setVersions, setCurrentVersionIndex, versions.length])

  return {
    versions,
    addVersion,
    currentVersionIndex,
    setCurrentVersionIndex,
    current,
  }
}

export default useGenData
