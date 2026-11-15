import type { ThoughtItem } from '@/app/components/base/chat/chat/type'
import type { FileEntity } from '@/app/components/base/file-uploader/types'
import type { VisionFile } from '@/types/app'
import { ToolType } from '../../workflow/block-selector/types'

export const getToolType = (type: string) => {
  switch (type) {
    case 'builtin':
      return ToolType.BuiltIn
    case 'api':
      return ToolType.Custom
    case 'workflow':
      return ToolType.Workflow
    case 'mcp':
      return ToolType.MCP
    default:
      return ToolType.BuiltIn
  }
}

export const sortAgentSorts = (list: ThoughtItem[]) => {
  if (!list) return list
  if (list.some((item) => item.position === undefined)) return list
  const temp = [...list]
  temp.sort((a, b) => a.position - b.position)
  return temp
}

export const addFileInfos = (list: ThoughtItem[], messageFiles: (FileEntity | VisionFile)[]) => {
  if (!list || !messageFiles) return list
  return list.map((item) => {
    if (item.files && item.files?.length > 0) {
      return {
        ...item,
        message_files: item.files.map((fileId) =>
          messageFiles.find((file) => file.id === fileId),
        ) as FileEntity[],
      }
    }
    return item
  })
}
