import type { AssetNodeType } from '@/types/app-asset'

export type SkillTemplateFileNode = {
  name: string
  node_type: Extract<AssetNodeType, 'file'>
  content: string
}

export type SkillTemplateFolderNode = {
  name: string
  node_type: Extract<AssetNodeType, 'folder'>
  children: SkillTemplateNode[]
}

export type SkillTemplateNode = SkillTemplateFileNode | SkillTemplateFolderNode

export type SkillTemplateFrontmatter = {
  name: string
  description: string
}

export type SkillTemplate = {
  id: string
  name: string
  description: string
  children: SkillTemplateNode[]
}

export type SkillTemplateMetadata = {
  tags?: string[]
  icon?: string
}

export type SkillTemplateWithMetadata = SkillTemplate & SkillTemplateMetadata

export type SkillTemplateTag = {
  id: string
  label: string
}
