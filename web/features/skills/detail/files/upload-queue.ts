import { v4 as uuid4 } from 'uuid'
import { joinSkillPath } from './tree-model'

type SkillUploadStatus = 'failed' | 'saving' | 'uploaded' | 'uploading'

export type SkillUploadQueueItem = {
  error?: string
  failureKind?: 'conflict' | 'network'
  file: File
  id: string
  name: string
  path: string
  progress: number
  status: SkillUploadStatus
  suggestedPath?: string
}

export function getUploadPath(file: File, basePath?: string) {
  return joinSkillPath(basePath, file.webkitRelativePath || file.name)
}

export function createUploadItemId() {
  return uuid4()
}

export function getUploadFileName(file: File) {
  return file.webkitRelativePath || file.name
}
