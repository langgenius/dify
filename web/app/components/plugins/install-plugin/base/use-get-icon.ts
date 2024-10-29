import { fetchIcon } from '@/service/plugins'
import { fetchWorkspaces } from '@/service/common'

let tenantId: string | null | undefined = null

const useGetIcon = () => {
  const getIcon = async (fileName: string) => {
    if (!tenantId) {
      const { workspaces } = await fetchWorkspaces({
        url: '/workspaces',
        params: {},
      })
      tenantId = workspaces.find(v => v.current)?.id
    }
    const res = await fetchIcon(tenantId!, fileName)
    return res
  }

  return {
    getIcon,
  }
}

export default useGetIcon
