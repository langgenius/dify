import { useAtomValue } from 'jotai'
import { useCallback } from 'react'
import { API_PREFIX } from '@/config'
import { currentWorkspaceIdAtom } from '@/context/workspace-state'

const useGetIcon = () => {
  const currentWorkspaceId = useAtomValue(currentWorkspaceIdAtom)
  const getIconUrl = useCallback(
    (fileName: string) => {
      return `${API_PREFIX}/workspaces/current/plugin/icon?tenant_id=${currentWorkspaceId}&filename=${fileName}`
    },
    [currentWorkspaceId],
  )

  return {
    getIconUrl,
  }
}

export default useGetIcon
