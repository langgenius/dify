export const SKILL_ROOT_ID = 'root' as const
export type ItemId = string
export type ParentId = ItemId | typeof SKILL_ROOT_ID | null

export enum ResourceKind {
  folder = 'folder',
  file = 'file',
}

export type ResourceItemBase = {
  id: ItemId
  name: string
  parent_id: ParentId
  path?: string
}

export type FolderItem = ResourceItemBase & {
  kind: ResourceKind.folder
}

export type FileItem = ResourceItemBase & {
  kind: ResourceKind.file
  ext?: string
  size?: number
}

export type ResourceItem = FolderItem | FileItem

export type ResourceItemList = ResourceItem[]
