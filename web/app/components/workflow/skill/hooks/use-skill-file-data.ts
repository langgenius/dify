import { useGetAppAssetFileContent, useGetAppAssetFileDownloadUrl } from '@/service/use-app-asset'

export type SkillFileDataResult = {
  fileContent: ReturnType<typeof useGetAppAssetFileContent>['data']
  downloadUrlData: ReturnType<typeof useGetAppAssetFileDownloadUrl>['data']
  isLoading: boolean
  error: Error | null
}

/**
 * Hook to fetch file data for skill documents.
 * Fetches content for editable files and download URL for media files.
 */
export function useSkillFileData(
  appId: string,
  nodeId: string | null | undefined,
  isMediaFile: boolean,
): SkillFileDataResult {
  const {
    data: fileContent,
    isLoading: isContentLoading,
    error: contentError,
  } = useGetAppAssetFileContent(appId, nodeId || '', {
    enabled: !isMediaFile,
  })

  const {
    data: downloadUrlData,
    isLoading: isDownloadUrlLoading,
    error: downloadUrlError,
  } = useGetAppAssetFileDownloadUrl(appId, nodeId || '', {
    enabled: isMediaFile && !!nodeId,
  })

  const isLoading = isMediaFile ? isDownloadUrlLoading : isContentLoading
  const error = isMediaFile ? downloadUrlError : contentError

  return {
    fileContent,
    downloadUrlData,
    isLoading,
    error,
  }
}
