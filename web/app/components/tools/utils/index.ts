import type { ThoughtItem } from '../../app/chat/type'
import type { VisionFile } from '@/types/app'

export const sortAgentSorts = (list: ThoughtItem[]) => {
  if (!list)
    return list
  if (list.some(item => item.position === undefined))
    return list
  const temp = [...list]
  temp.sort((a, b) => a.position - b.position)
  return temp
}

export const addFileInfos = (list: ThoughtItem[], messageFiles: VisionFile[]) => {
  if (!list)
    return list
  return list.map((item) => {
    if (item.message_file_id && item.message_file_id?.length > 0) {
      return {
        ...item,
        message_files: item.message_file_id.map(fileId => messageFiles.find(file => file.id === fileId)) as VisionFile[],
      }
    }
    return item
  })
}
