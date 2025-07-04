import { type OnlineDriveFile, OnlineDriveFileType } from '@/models/pipeline'
import type { OnlineDriveData } from '@/types/pipeline'

const filePathRegex = /^(?:.*\/)?[^\/]+\.[^\/\.]+$/

export const isFile = (path: string): boolean => {
  return filePathRegex.test(path)
}

export const hasBuckets = (data: OnlineDriveData[]): boolean => {
  return data.length > 1 || (data.length === 1 && data[0].files.length === 0)
}

export const convertOnlineDriveDataToFileList = (data: OnlineDriveData[]): OnlineDriveFile[] => {
  const fileList: OnlineDriveFile[] = []

  if (hasBuckets(data)) {
    data.forEach((item) => {
      fileList.push({
        key: item.bucket,
        type: OnlineDriveFileType.bucket,
      })
    })
  }
  else {
    data[0].files.forEach((file) => {
      fileList.push({
        key: file.key,
        size: isFile(file.key) ? file.size : undefined,
        type: isFile(file.key) ? OnlineDriveFileType.file : OnlineDriveFileType.folder,
      })
    })
  }
  return fileList
}
