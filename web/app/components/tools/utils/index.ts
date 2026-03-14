import type { ThoughtItem } from '@/app/components/base/chat/chat/type'
import type { FileEntity } from '@/app/components/base/file-uploader/types'
import type { VisionFile } from '@/types/app'
import type { FileResponse } from '@/types/workflow'
import { getProcessedFilesFromResponse } from '@/app/components/base/file-uploader/utils'
import { ToolTypeEnum } from '../../workflow/block-selector/types'

export const getToolType = (type: string) => {
  switch (type) {
    case 'builtin':
      return ToolTypeEnum.BuiltIn
    case 'api':
      return ToolTypeEnum.Custom
    case 'workflow':
      return ToolTypeEnum.Workflow
    case 'mcp':
      return ToolTypeEnum.MCP
    default:
      return ToolTypeEnum.BuiltIn
  }
}

export const sortAgentSorts = (list: ThoughtItem[]) => {
  if (!list)
    return list
  if (list.some(item => item.position === undefined))
    return list
  const temp = [...list]
  temp.sort((a, b) => a.position - b.position)
  return temp
}

type AgentThoughtHistoryFile = FileResponse & { id: string }
type AgentThoughtMessageFile = FileEntity | VisionFile | AgentThoughtHistoryFile

const isFileEntity = (file: AgentThoughtMessageFile): file is FileEntity => {
  return 'transferMethod' in file
}

const isAgentThoughtHistoryFile = (file: AgentThoughtMessageFile): file is AgentThoughtHistoryFile => {
  return 'filename' in file && 'mime_type' in file
}

const getVisionFileMimeType = (fileType: string) => {
  if (fileType.includes('/'))
    return fileType

  switch (fileType) {
    case 'image':
      return 'image/png'
    case 'video':
      return 'video/mp4'
    case 'audio':
      return 'audio/mpeg'
    default:
      return 'application/octet-stream'
  }
}

const getVisionFileSupportType = (fileType: string) => {
  if (fileType.includes('/')) {
    const [mainType, subType] = fileType.split('/')
    if (mainType === 'image')
      return 'image'
    if (mainType === 'video')
      return 'video'
    if (mainType === 'audio')
      return 'audio'
    if (subType === 'pdf')
      return 'document'
    return 'document'
  }

  switch (fileType) {
    case 'image':
      return 'image'
    case 'video':
      return 'video'
    case 'audio':
      return 'audio'
    case 'document':
      return 'document'
    default:
      return 'document'
  }
}

const getVisionFileName = (url: string, supportFileType: string) => {
  const fileName = url.split('/').pop()?.split('?')[0]
  if (fileName)
    return fileName

  switch (supportFileType) {
    case 'image':
      return 'generated_image.png'
    case 'video':
      return 'generated_video.mp4'
    case 'audio':
      return 'generated_audio.mp3'
    default:
      return 'generated_file.bin'
  }
}

const normalizeAgentThoughtMessageFile = (file: AgentThoughtMessageFile): FileEntity => {
  if (isFileEntity(file))
    return file

  if (!isAgentThoughtHistoryFile(file)) {
    const supportFileType = getVisionFileSupportType(file.type)
    return {
      id: file.id || file.upload_file_id,
      name: getVisionFileName(file.url, supportFileType),
      size: 0,
      type: getVisionFileMimeType(file.type),
      progress: 100,
      transferMethod: file.transfer_method,
      supportFileType,
      uploadedId: file.upload_file_id,
      url: file.url,
    }
  }

  return getProcessedFilesFromResponse([{
    ...file,
    related_id: file.id,
  }])[0]
}

export const addFileInfos = (list: ThoughtItem[], messageFiles: AgentThoughtMessageFile[]) => {
  if (!list || !messageFiles)
    return list
  return list.map((item) => {
    if (item.files && item.files?.length > 0) {
      const matchedFiles = item.files
        .map(fileId => messageFiles.find(file => (file.id || ('upload_file_id' in file ? file.upload_file_id : '')) === fileId))
        .filter((file): file is AgentThoughtMessageFile => Boolean(file))
        .map(normalizeAgentThoughtMessageFile)

      return {
        ...item,
        message_files: matchedFiles,
      }
    }
    return item
  })
}
