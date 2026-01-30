import type { ExtractedZipResult } from './zip-extract'
import type { BatchUploadNodeInput } from '@/types/app-asset'
import { getFileExtension } from './file-utils'
import { prepareSkillUploadFile } from './skill-upload-utils'

export type ZipUploadData = {
  tree: BatchUploadNodeInput[]
  files: Map<string, File>
}

function uint8ArrayToFile(data: Uint8Array, name: string): File {
  const ext = getFileExtension(name)
  const type = ext === 'md' || ext === 'markdown' || ext === 'mdx'
    ? 'text/markdown'
    : 'application/octet-stream'
  const buffer = new ArrayBuffer(data.byteLength)
  new Uint8Array(buffer).set(data)
  return new File([buffer], name, { type })
}

export async function buildUploadDataFromZip(extracted: ExtractedZipResult): Promise<ZipUploadData> {
  const fileMap = new Map<string, File>()
  const tree: BatchUploadNodeInput[] = []
  const folderMap = new Map<string, BatchUploadNodeInput>()

  const entries = await Promise.all(
    Array.from(extracted.files.entries()).map(async ([path, data]) => {
      const fileName = path.split('/').pop()!
      const rawFile = uint8ArrayToFile(data, fileName)
      const prepared = await prepareSkillUploadFile(rawFile)
      return { path, prepared }
    }),
  )

  for (const { path, prepared } of entries) {
    fileMap.set(path, prepared)

    const parts = path.split('/')
    let currentLevel = tree
    let currentPath = ''

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]
      const isLastPart = i === parts.length - 1
      currentPath = currentPath ? `${currentPath}/${part}` : part

      if (isLastPart) {
        currentLevel.push({
          name: part,
          node_type: 'file',
          size: prepared.size,
        })
      }
      else {
        let folder = folderMap.get(currentPath)
        if (!folder) {
          folder = {
            name: part,
            node_type: 'folder',
            children: [],
          }
          folderMap.set(currentPath, folder)
          currentLevel.push(folder)
        }
        currentLevel = folder.children!
      }
    }
  }

  return { tree, files: fileMap }
}
