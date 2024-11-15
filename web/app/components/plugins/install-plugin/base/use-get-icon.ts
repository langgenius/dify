import { useCallback } from 'react'
import { apiPrefix } from '@/config'
import { useSelector } from '@/context/app-context'

const useGetIcon = () => {
  const currentWorkspace = useSelector(s => s.currentWorkspace)
  const getIconUrl = useCallback((fileName: string) => {
    return `${apiPrefix}/workspaces/current/plugin/icon?tenant_id=${currentWorkspace.id}&filename=${fileName}`
  }, [currentWorkspace.id])

  return {
    getIconUrl,
  }
}

export default useGetIcon
