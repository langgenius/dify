import { useCallback } from 'react'
import { API_PREFIX } from '@/config'
import { useSelector } from '@/context/app-context'

const useGetIcon = () => {
  const currentWorkspace = useSelector(s => s.currentWorkspace)
  const getIconUrl = useCallback((fileName: string) => {
    return `${API_PREFIX}/workspaces/current/plugin/icon?tenant_id=${currentWorkspace.id}&filename=${fileName}`
  }, [currentWorkspace.id])

  return {
    getIconUrl,
  }
}

export default useGetIcon
