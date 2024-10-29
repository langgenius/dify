import { apiPrefix } from '@/config'
import { fetchWorkspaces } from '@/service/common'

let tenantId: string | null | undefined = null

const useGetIcon = () => {
  const getIconUrl = async (fileName: string) => {
    if (!tenantId) {
      const { workspaces } = await fetchWorkspaces({
        url: '/workspaces',
        params: {},
      })
      tenantId = workspaces.find(v => v.current)?.id
    }
    return `${apiPrefix}/workspaces/current/plugin/icon?tenant_id=${tenantId}&filename=${fileName}`
  }

  return {
    getIconUrl,
  }
}

export default useGetIcon
