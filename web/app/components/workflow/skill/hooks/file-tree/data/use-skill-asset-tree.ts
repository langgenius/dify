import type { AppAssetTreeResponse, AppAssetTreeView } from '@/types/app-asset'
import { useQuery } from '@tanstack/react-query'
import { useStore as useAppStore } from '@/app/components/app/store'
import { appAssetTreeOptions } from '@/service/use-app-asset'
import { buildNodeMap } from '../../../utils/tree-utils'

function useSkillAppId(): string {
  const appDetail = useAppStore(s => s.appDetail)
  return appDetail?.id || ''
}

export function useSkillAssetTreeData() {
  const appId = useSkillAppId()
  return useQuery(appAssetTreeOptions(appId))
}

export function useSkillAssetNodeMap() {
  const appId = useSkillAppId()
  return useQuery({
    ...appAssetTreeOptions(appId),
    select: (data: AppAssetTreeResponse): Map<string, AppAssetTreeView> => {
      if (!data?.children)
        return new Map()
      return buildNodeMap(data.children)
    },
  })
}

export function useExistingSkillNames() {
  const appId = useSkillAppId()
  return useQuery({
    ...appAssetTreeOptions(appId),
    select: (data: AppAssetTreeResponse): Set<string> => {
      if (!data?.children)
        return new Set()
      const names = new Set<string>()
      for (const node of data.children) {
        if (node.node_type === 'folder')
          names.add(node.name)
      }
      return names
    },
  })
}
