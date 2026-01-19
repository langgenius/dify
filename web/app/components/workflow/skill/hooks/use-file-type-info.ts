import type { AppAssetTreeView } from '@/types/app-asset'
import { useMemo } from 'react'
import {
  getFileExtension,
  isCodeOrTextFile,
  isImageFile,
  isMarkdownFile,
  isVideoFile,
} from '../utils/file-utils'

export type FileTypeInfo = {
  isMarkdown: boolean
  isCodeOrText: boolean
  isImage: boolean
  isVideo: boolean
  isEditable: boolean
  isMediaFile: boolean
}

/**
 * Hook to determine file type information based on file node.
 * Returns flags for markdown, code/text, image, video files.
 */
export function useFileTypeInfo(fileNode: AppAssetTreeView | undefined): FileTypeInfo {
  return useMemo(() => {
    const ext = getFileExtension(fileNode?.name, fileNode?.extension)
    const markdown = isMarkdownFile(ext)
    const codeOrText = isCodeOrTextFile(ext)
    const image = isImageFile(ext)
    const video = isVideoFile(ext)

    return {
      isMarkdown: markdown,
      isCodeOrText: codeOrText,
      isImage: image,
      isVideo: video,
      isEditable: markdown || codeOrText,
      isMediaFile: image || video,
    }
  }, [fileNode?.name, fileNode?.extension])
}
