import type { AppAssetTreeResponse, AppAssetTreeView } from '@/types/app-asset'
import { useStore as useAppStore } from '@/app/components/app/store'
import { useGetAppAssetTree } from '@/service/use-app-asset'
import { buildNodeMap } from '../utils/tree-utils'

/**
 * Get the current app ID from the app store.
 * Used internally by skill asset tree hooks.
 */
function useSkillAppId(): string {
  const appDetail = useAppStore(s => s.appDetail)
  return appDetail?.id || ''
}

/**
 * Hook to get the asset tree data for the current skill app.
 * Returns the raw tree data along with loading and error states.
 */
export function useSkillAssetTreeData() {
  const appId = useSkillAppId()
  return useGetAppAssetTree(appId)
}

/**
 * Hook to get the node map (id -> node) for the current skill app.
 * Uses TanStack Query's select option to compute and cache the map.
 */
export function useSkillAssetNodeMap() {
  const appId = useSkillAppId()
  return useGetAppAssetTree(appId, {
    select: (data: AppAssetTreeResponse): Map<string, AppAssetTreeView> => {
      if (!data?.children)
        return new Map()
      return buildNodeMap(data.children)
    },
  })
}

/**
 * Hook to get the set of root-level folder names in the skill asset tree.
 * Useful for checking whether a skill template has already been added.
 */
export function useExistingSkillNames() {
  const appId = useSkillAppId()
  return useGetAppAssetTree(appId, {
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
