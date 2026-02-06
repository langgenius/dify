import { useGetAppAssetFileContent, useGetAppAssetFileDownloadUrl } from '@/service/use-app-asset'

export type SkillFileDataMode = 'none' | 'content' | 'download'

export type SkillFileDataResult = {
  fileContent: ReturnType<typeof useGetAppAssetFileContent>['data']
  downloadUrlData: ReturnType<typeof useGetAppAssetFileDownloadUrl>['data']
  isLoading: boolean
  error: Error | null
}

/**
 * Hook to fetch file data for skill documents.
 * Uses explicit mode to control data fetching:
 * - 'content': fetch editable file content
 * - 'download': fetch non-editable file download URL
 * - 'none': skip file-related requests while node metadata is unresolved
 */
export function useSkillFileData(
  appId: string,
  nodeId: string | null | undefined,
  mode: SkillFileDataMode,
): SkillFileDataResult {
  const {
    data: fileContent,
    isLoading: isContentLoading,
    error: contentError,
  } = useGetAppAssetFileContent(appId, nodeId || '', {
    enabled: mode === 'content',
  })

  const {
    data: downloadUrlData,
    isLoading: isDownloadUrlLoading,
    error: downloadUrlError,
  } = useGetAppAssetFileDownloadUrl(appId, nodeId || '', {
    enabled: mode === 'download' && !!nodeId,
  })

  const isLoading = mode === 'content'
    ? isContentLoading
    : mode === 'download'
      ? isDownloadUrlLoading
      : false
  const error = mode === 'content'
    ? contentError
    : mode === 'download'
      ? downloadUrlError
      : null

  return {
    fileContent,
    downloadUrlData,
    isLoading,
    error,
  }
}
