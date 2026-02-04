import { useMemo } from 'react'
import {
  getFileExtension,
  isImageFile,
  isMarkdownFile,
  isSQLiteFile,
  isTextLikeFile,
  isVideoFile,
} from '../utils/file-utils'

export type FileTypeInfo = {
  isMarkdown: boolean
  isCodeOrText: boolean
  isImage: boolean
  isVideo: boolean
  isSQLite: boolean
  isEditable: boolean
  isMediaFile: boolean
  isPreviewable: boolean
}

export function useFileTypeInfo(fileNode: { name: string, extension?: string | null } | undefined): FileTypeInfo {
  return useMemo(() => {
    if (!fileNode) {
      return {
        isMarkdown: false,
        isCodeOrText: false,
        isImage: false,
        isVideo: false,
        isSQLite: false,
        isEditable: false,
        isMediaFile: false,
        isPreviewable: false,
      }
    }

    const ext = getFileExtension(fileNode.name, fileNode.extension ?? undefined)
    const markdown = isMarkdownFile(ext)
    const image = isImageFile(ext)
    const video = isVideoFile(ext)
    const sqlite = isSQLiteFile(ext)
    const editable = isTextLikeFile(ext)
    const codeOrText = editable && !markdown

    return {
      isMarkdown: markdown,
      isCodeOrText: codeOrText,
      isImage: image,
      isVideo: video,
      isSQLite: sqlite,
      isEditable: editable,
      isMediaFile: image || video,
      isPreviewable: editable || image || video || sqlite,
    }
  }, [fileNode?.name, fileNode?.extension])
}
