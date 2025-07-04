import { type OnlineDriveFile, OnlineDriveFileType } from '@/models/pipeline'
import type { OnlineDriveData } from '@/types/pipeline'

const filePathRegex = /^(?:.*\/)?[^\/]+\.[^\/\.]+$/

export const isFile = (path: string): boolean => {
  return filePathRegex.test(path)
}

export const isBucketListInitiation = (data: OnlineDriveData[], prefix: string[]): boolean => {
  if (prefix.length > 0) return false
  return data.length > 1 || (data.length === 1 && data[0].files.length === 0)
}

export const convertOnlineDriveDataToFileList = (data: OnlineDriveData[], prefix: string[]): OnlineDriveFile[] => {
  const fileList: OnlineDriveFile[] = []

  if (data.length === 0)
    return fileList

  if (isBucketListInitiation(data, prefix)) {
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
  }
  return fileList
}
