import type { AssetNodeType } from '@/types/app-asset'

export type SkillTemplateFileNode = {
  name: string
  node_type: Extract<AssetNodeType, 'file'>
  content: string
  encoding?: 'base64'
}

export type SkillTemplateFolderNode = {
  name: string
  node_type: Extract<AssetNodeType, 'folder'>
  children: SkillTemplateNode[]
}

export type SkillTemplateNode = SkillTemplateFileNode | SkillTemplateFolderNode

export type SkillTemplateSummary = {
  id: string
  name: string
  description: string
  fileCount: number
}

export type SkillTemplateEntry = SkillTemplateSummary & {
  loadContent: () => Promise<SkillTemplateNode[]>
}
