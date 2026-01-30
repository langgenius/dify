import type { SkillTemplate, SkillTemplateNode } from './types'
import type { BatchUploadNodeInput } from '@/types/app-asset'
import { prepareSkillUploadFile } from '../../utils/skill-upload-utils'

type TemplateUploadData = {
  tree: BatchUploadNodeInput[]
  files: Map<string, File>
}

export async function buildUploadDataFromTemplate(
  template: SkillTemplate,
): Promise<TemplateUploadData> {
  const files = new Map<string, File>()

  async function convertNode(
    node: SkillTemplateNode,
    pathPrefix: string,
  ): Promise<BatchUploadNodeInput> {
    const currentPath = pathPrefix ? `${pathPrefix}/${node.name}` : node.name

    if (node.node_type === 'folder') {
      const children = await Promise.all(
        node.children.map(child => convertNode(child, currentPath)),
      )
      return { name: node.name, node_type: 'folder', children }
    }

    const raw = new File([node.content], node.name, { type: 'text/plain' })
    const prepared = await prepareSkillUploadFile(raw)
    files.set(currentPath, prepared)
    return { name: node.name, node_type: 'file', size: prepared.size }
  }

  const rootFolder: BatchUploadNodeInput = {
    name: template.name,
    node_type: 'folder',
    children: await Promise.all(
      template.children.map(child => convertNode(child, template.name)),
    ),
  }

  return { tree: [rootFolder], files }
}
