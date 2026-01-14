export const SKILL_ROOT_ID = 'root' as const
export type SkillItemId = string
export type SkillParentId = SkillItemId | typeof SKILL_ROOT_ID | null

export enum SkillItemKind {
  folder = 'folder',
  file = 'file',
}

export type SkillItemBase = {
  id: SkillItemId
  name: string
  parent_id: SkillParentId
  path?: string
}

export type SkillFolderItem = SkillItemBase & {
  kind: 'folder'
}

export type SkillFileItem = SkillItemBase & {
  kind: 'file'
  ext?: string
  size?: number
}

export type SkillItem = SkillFolderItem | SkillFileItem

export type SkillList = SkillItem[]
