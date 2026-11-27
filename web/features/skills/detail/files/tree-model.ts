import type { SkillFileResponse } from '@dify/contracts/api/console/workspaces/types.gen'
import { isDirectory, isTextFile } from './file-format'

export type FileTreeNode = {
  children?: FileTreeNode[]
  file?: SkillFileResponse
  id: string
  name: string
  path: string
  type: 'directory' | 'file'
}

export type FileTreeInlineAction =
  | {
      kind: 'create'
      nodeType: 'directory' | 'file'
      parentPath?: string
    }
  | {
      kind: 'rename'
      nodeType: 'directory' | 'file'
      path: string
    }

export function toFileTree(files: SkillFileResponse[]): FileTreeNode[] {
  const root: FileTreeNode[] = []
  const folders = new Map<string, FileTreeNode>()

  for (const file of files) {
    const segments = file.path.split('/').filter(Boolean)
    if (segments.length === 0) continue

    let siblings = root
    let currentPath = ''

    segments.forEach((segment, index) => {
      currentPath = currentPath ? `${currentPath}/${segment}` : segment
      const isLeaf = index === segments.length - 1
      const shouldCreateFolder = !isLeaf || isDirectory(file)

      if (shouldCreateFolder) {
        const existingFolder = folders.get(currentPath)
        if (existingFolder) {
          siblings = existingFolder.children ?? []
          return
        }

        const folder: FileTreeNode = {
          children: [],
          id: currentPath,
          name: segment,
          path: currentPath,
          type: 'directory',
        }
        folders.set(currentPath, folder)
        siblings.push(folder)
        siblings = folder.children ?? []
        return
      }

      siblings.push({
        file,
        id: file.path,
        name: segment,
        path: file.path,
        type: 'file',
      })
    })
  }

  return root
}

export function flattenFileTree(nodes: FileTreeNode[]): FileTreeNode[] {
  return nodes.flatMap((node) => [node, ...(node.children ? flattenFileTree(node.children) : [])])
}

export function getFirstTextFile(files: SkillFileResponse[]) {
  return (
    files.find((file) => file.path === 'SKILL.md') ??
    files.find((file) => !isDirectory(file) && isTextFile(file)) ??
    files.find((file) => !isDirectory(file))
  )
}

export function findFileByPath(files: SkillFileResponse[], path: string | undefined) {
  if (!path) return undefined

  return files.find((file) => file.path === path)
}

export function getPathBaseName(path: string) {
  return path.split('/').filter(Boolean).at(-1) ?? path
}

function getCopyFileName(fileName: string, index: number) {
  const extensionIndex = fileName.lastIndexOf('.')
  const hasExtension = extensionIndex > 0
  const name = hasExtension ? fileName.slice(0, extensionIndex) : fileName
  const extension = hasExtension ? fileName.slice(extensionIndex) : ''
  const suffix = index === 1 ? ' copy' : ` copy ${index}`
  return `${name}${suffix}${extension}`
}

export function getCopyTargetPath(
  files: SkillFileResponse[],
  targetDirectory: string | undefined,
  sourcePath: string,
  pendingTargetPaths: string[],
) {
  const existingPaths = new Set([...files.map((file) => file.path), ...pendingTargetPaths])
  const fileName = getPathBaseName(sourcePath)
  const directTargetPath = joinSkillPath(targetDirectory, fileName)
  if (directTargetPath !== sourcePath && !existingPaths.has(directTargetPath))
    return directTargetPath

  for (let index = 1; index < 1000; index += 1) {
    const targetPath = joinSkillPath(targetDirectory, getCopyFileName(fileName, index))
    if (!existingPaths.has(targetPath)) return targetPath
  }

  return undefined
}

export function getPathDirName(path: string) {
  const segments = path.split('/').filter(Boolean)
  segments.pop()
  return segments.join('/')
}

export function isNestedPath(parentPath: string, childPath: string) {
  return childPath.startsWith(`${parentPath}/`)
}

export function joinSkillPath(basePath: string | undefined, name: string) {
  const normalizedBase = (basePath ?? '').replace(/^\/+|\/+$/g, '')
  const normalizedName = name.replace(/^\/+/g, '')
  return normalizedBase ? `${normalizedBase}/${normalizedName}` : normalizedName
}
