import type { AppAssetTreeResponse, AppAssetTreeView } from '@/types/app-asset'
import { useQuery } from '@tanstack/react-query'
import { useStore as useAppStore } from '@/app/components/app/store'
import { appAssetTreeOptions } from '@/service/use-app-asset'
import { buildNodeMap } from '../../../utils/tree-utils'

type SkillAssetIndex = {
  nodeMap: Map<string, AppAssetTreeView>
  existingSkillNames: Set<string>
}

const EMPTY_NODE_MAP = new Map<string, AppAssetTreeView>()
const EMPTY_SKILL_NAMES = new Set<string>()
const EMPTY_SKILL_ASSET_INDEX: SkillAssetIndex = {
  nodeMap: EMPTY_NODE_MAP,
  existingSkillNames: EMPTY_SKILL_NAMES,
}
const skillAssetIndexCache = new WeakMap<AppAssetTreeResponse, SkillAssetIndex>()

function useSkillAppId(): string {
  const appDetail = useAppStore(s => s.appDetail)
  return appDetail?.id || ''
}

export function getSkillAssetIndex(data?: AppAssetTreeResponse | null): SkillAssetIndex {
  if (!data?.children?.length)
    return EMPTY_SKILL_ASSET_INDEX

  const cachedIndex = skillAssetIndexCache.get(data)
  if (cachedIndex)
    return cachedIndex

  const existingSkillNames = new Set<string>()
  for (const node of data.children) {
    if (node.node_type === 'folder')
      existingSkillNames.add(node.name)
  }

  const index = {
    nodeMap: buildNodeMap(data.children),
    existingSkillNames,
  }
  skillAssetIndexCache.set(data, index)
  return index
}

const selectSkillAssetNodeMap = (data: AppAssetTreeResponse) => getSkillAssetIndex(data).nodeMap
const selectExistingSkillNames = (data: AppAssetTreeResponse) => getSkillAssetIndex(data).existingSkillNames

export function useSkillAssetTreeData() {
  const appId = useSkillAppId()
  return useQuery(appAssetTreeOptions(appId))
}

export function useSkillAssetNodeMap() {
  const appId = useSkillAppId()
  return useQuery({
    ...appAssetTreeOptions(appId),
    select: selectSkillAssetNodeMap,
  })
}

export function useExistingSkillNames() {
  const appId = useSkillAppId()
  return useQuery({
    ...appAssetTreeOptions(appId),
    select: selectExistingSkillNames,
  })
}
