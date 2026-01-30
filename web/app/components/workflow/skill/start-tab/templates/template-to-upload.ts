import type { SkillTemplateNode } from './types'
import type { BatchUploadNodeInput } from '@/types/app-asset'
import { prepareSkillUploadFile } from '../../utils/skill-upload-utils'

type TemplateUploadData = {
  tree: BatchUploadNodeInput[]
  files: Map<string, File>
}

export async function buildUploadDataFromTemplate(
  name: string,
  children: SkillTemplateNode[],
): Promise<TemplateUploadData> {
  const files = new Map<string, File>()

  async function convertNode(
    node: SkillTemplateNode,
    pathPrefix: string,
  ): Promise<BatchUploadNodeInput> {
    const currentPath = pathPrefix ? `${pathPrefix}/${node.name}` : node.name

    if (node.node_type === 'folder') {
      const converted = await Promise.all(
        node.children.map(child => convertNode(child, currentPath)),
      )
      return { name: node.name, node_type: 'folder', children: converted }
    }

    let fileData: BlobPart
    if (node.encoding === 'base64') {
      const binary = atob(node.content)
      const bytes = new Uint8Array(binary.length)
      for (let i = 0; i < binary.length; i++)
        bytes[i] = binary.charCodeAt(i)
      fileData = bytes
    }
    else {
      fileData = node.content
    }
    const raw = new File([fileData], node.name)
    const prepared = await prepareSkillUploadFile(raw)
    files.set(currentPath, prepared)
    return { name: node.name, node_type: 'file', size: prepared.size }
  }

  const rootFolder: BatchUploadNodeInput = {
    name,
    node_type: 'folder',
    children: await Promise.all(
      children.map(child => convertNode(child, name)),
    ),
  }

  return { tree: [rootFolder], files }
}
