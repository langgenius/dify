import type { FileEntity } from './types'
import type { FileUploadConfigResponse } from '@/models/common'
import {
  DEFAULT_IMAGE_FILE_BATCH_LIMIT,
  DEFAULT_IMAGE_FILE_SIZE_LIMIT,
  DEFAULT_SINGLE_CHUNK_ATTACHMENT_LIMIT,
} from './constants'

export const getFileType = (currentFile: File) => {
  if (!currentFile)
    return ''

  const arr = currentFile.name.split('.')
  return arr[arr.length - 1]
}

type FileWithPath = {
  relativePath?: string
} & File

export const traverseFileEntry = (entry: any, prefix = ''): Promise<FileWithPath[]> => {
  return new Promise((resolve) => {
    if (entry.isFile) {
      entry.file((file: FileWithPath) => {
        file.relativePath = `${prefix}${file.name}`
        resolve([file])
      })
    }
    else if (entry.isDirectory) {
      const reader = entry.createReader()
      const entries: any[] = []
      const read = () => {
        reader.readEntries(async (results: FileSystemEntry[]) => {
          if (!results.length) {
            const files = await Promise.all(
              entries.map(ent =>
                traverseFileEntry(ent, `${prefix}${entry.name}/`),
              ),
            )
            resolve(files.flat())
          }
          else {
            entries.push(...results)
            read()
          }
        })
      }
      read()
    }
    else {
      resolve([])
    }
  })
}

export const fileIsUploaded = (file: FileEntity) => {
  if (file.uploadedId || file.progress === 100)
    return true
}

const getNumberValue = (value: number | string | undefined | null): number => {
  if (value === undefined || value === null)
    return 0
  if (typeof value === 'number')
    return value
  if (typeof value === 'string')
    return Number(value)
  return 0
}

export const getFileUploadConfig = (fileUploadConfigResponse: FileUploadConfigResponse | undefined) => {
  if (!fileUploadConfigResponse) {
    return {
      imageFileSizeLimit: DEFAULT_IMAGE_FILE_SIZE_LIMIT,
      imageFileBatchLimit: DEFAULT_IMAGE_FILE_BATCH_LIMIT,
      singleChunkAttachmentLimit: DEFAULT_SINGLE_CHUNK_ATTACHMENT_LIMIT,
    }
  }
  const {
    image_file_batch_limit,
    single_chunk_attachment_limit,
    attachment_image_file_size_limit,
  } = fileUploadConfigResponse
  const imageFileSizeLimit = getNumberValue(attachment_image_file_size_limit)
  const imageFileBatchLimit = getNumberValue(image_file_batch_limit)
  const singleChunkAttachmentLimit = getNumberValue(single_chunk_attachment_limit)
  return {
    imageFileSizeLimit: imageFileSizeLimit > 0 ? imageFileSizeLimit : DEFAULT_IMAGE_FILE_SIZE_LIMIT,
    imageFileBatchLimit: imageFileBatchLimit > 0 ? imageFileBatchLimit : DEFAULT_IMAGE_FILE_BATCH_LIMIT,
    singleChunkAttachmentLimit: singleChunkAttachmentLimit > 0 ? singleChunkAttachmentLimit : DEFAULT_SINGLE_CHUNK_ATTACHMENT_LIMIT,
  }
}
