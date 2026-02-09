import type { AppAssetTreeView } from '@/types/app-asset'

export type TreeNodeData = AppAssetTreeView

export type SkillTabType = 'start' | 'file'

export type SkillTabItem = {
  id: string
  type: SkillTabType
  name: string
  extension?: string
  isDirty?: boolean
}
