import type { ThoughtItem } from '@/app/components/base/chat/chat/type'
import type { FileEntity } from '@/app/components/base/file-uploader/types'
import type { VisionFile } from '@/types/app'
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

export const addFileInfos = (list: ThoughtItem[], messageFiles: (FileEntity | VisionFile)[]) => {
  if (!list || !messageFiles)
    return list
  return list.map((item) => {
    if (item.files && item.files?.length > 0) {
      return {
        ...item,
        message_files: item.files.map(fileId => messageFiles.find(file => file.id === fileId)) as FileEntity[],
      }
    }
    return item
  })
}
