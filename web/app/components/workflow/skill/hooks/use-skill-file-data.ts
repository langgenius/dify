import { useGetAppAssetFileContent, useGetAppAssetFileDownloadUrl } from '@/service/use-app-asset'

export type SkillFileDataResult = {
  fileContent: ReturnType<typeof useGetAppAssetFileContent>['data']
  downloadUrlData: ReturnType<typeof useGetAppAssetFileDownloadUrl>['data']
  isLoading: boolean
  error: Error | null
}

/**
 * Hook to fetch file data for skill documents.
 * Fetches content for editable files and download URL for non-editable files.
 */
export function useSkillFileData(
  appId: string,
  nodeId: string | null | undefined,
  isEditable: boolean,
): SkillFileDataResult {
  const {
    data: fileContent,
    isLoading: isContentLoading,
    error: contentError,
  } = useGetAppAssetFileContent(appId, nodeId || '', {
    enabled: isEditable,
  })

  const {
    data: downloadUrlData,
    isLoading: isDownloadUrlLoading,
    error: downloadUrlError,
  } = useGetAppAssetFileDownloadUrl(appId, nodeId || '', {
    enabled: !isEditable && !!nodeId,
  })

  const isLoading = isEditable ? isContentLoading : isDownloadUrlLoading
  const error = isEditable ? contentError : downloadUrlError

  return {
    fileContent,
    downloadUrlData,
    isLoading,
    error,
  }
}
