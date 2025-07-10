import { type OnlineDriveFile, OnlineDriveFileType } from '@/models/pipeline'
import type { OnlineDriveData } from '@/types/pipeline'

const filePathRegex = /^(?:.*\/)?[^\/]+\.[^\/\.]+$/

export const isFile = (path: string): boolean => {
  return filePathRegex.test(path)
}

export const isBucketListInitiation = (data: OnlineDriveData[], prefix: string[], bucket: string): boolean => {
  if (bucket || prefix.length > 0) return false
  return data.length > 1 || (data.length === 1 && data[0].files.length === 0)
}

export const convertOnlineDriveData = (data: OnlineDriveData[], prefix: string[], bucket: string): { fileList: OnlineDriveFile[], isTruncated: boolean } => {
  const fileList: OnlineDriveFile[] = []
  let isTruncated = false

  if (data.length === 0)
    return { fileList, isTruncated }

  if (isBucketListInitiation(data, prefix, bucket)) {
    data.forEach((item) => {
      fileList.push({
        key: item.bucket,
        displayName: item.bucket,
        type: OnlineDriveFileType.bucket,
      })
    })
  }
  else {
    data[0].files.forEach((file) => {
      const isFileType = isFile(file.key)
      const filePathList = file.key.split('/')
      fileList.push({
        key: file.key,
        displayName: `${isFileType ? filePathList.pop() : filePathList[filePathList.length - 2]}${isFileType ? '' : '/'}`,
        size: isFileType ? file.size : undefined,
        type: isFileType ? OnlineDriveFileType.file : OnlineDriveFileType.folder,
      })
    })
    isTruncated = data[0].is_truncated ?? false
  }
  return { fileList, isTruncated }
}
