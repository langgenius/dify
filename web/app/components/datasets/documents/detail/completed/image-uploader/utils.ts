import type { FileEntity } from './types'

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
