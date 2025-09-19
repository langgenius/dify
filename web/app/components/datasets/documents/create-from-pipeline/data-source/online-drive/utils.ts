import { type OnlineDriveFile, OnlineDriveFileType } from '@/models/pipeline'
import type { OnlineDriveData } from '@/types/pipeline'

export const isFile = (type: 'file' | 'folder'): boolean => {
  return type === 'file'
}

export const isBucketListInitiation = (data: OnlineDriveData[], prefix: string[], bucket: string): boolean => {
  if (bucket || prefix.length > 0) return false
  const hasBucket = data.every(item => !!item.bucket)
  return hasBucket && (data.length > 1 || (data.length === 1 && !!data[0].bucket && data[0].files.length === 0))
}

export const convertOnlineDriveData = (data: OnlineDriveData[], prefix: string[], bucket: string): {
  fileList: OnlineDriveFile[],
  isTruncated: boolean,
  nextPageParameters: Record<string, any>
  hasBucket: boolean
} => {
  const fileList: OnlineDriveFile[] = []
  let isTruncated = false
  let nextPageParameters: Record<string, any> = {}
  let hasBucket = false

  if (data.length === 0)
    return { fileList, isTruncated, nextPageParameters, hasBucket }

  if (isBucketListInitiation(data, prefix, bucket)) {
    data.forEach((item) => {
      fileList.push({
        id: item.bucket,
        name: item.bucket,
        type: OnlineDriveFileType.bucket,
      })
    })
    hasBucket = true
  }
  else {
    data[0].files.forEach((file) => {
      const { id, name, size, type } = file
      const isFileType = isFile(type)
      fileList.push({
        id,
        name,
        size: isFileType ? size : undefined,
        type: isFileType ? OnlineDriveFileType.file : OnlineDriveFileType.folder,
      })
    })
    isTruncated = data[0].is_truncated ?? false
    nextPageParameters = data[0].next_page_parameters ?? {}
    hasBucket = !!data[0].bucket
  }
  return { fileList, isTruncated, nextPageParameters, hasBucket }
}
