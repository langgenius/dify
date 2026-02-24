import { useQuery } from '@tanstack/react-query'
import { appAssetFileContentOptions, appAssetFileDownloadUrlOptions } from '@/service/use-app-asset'

export type SkillFileDataMode = 'none' | 'content' | 'download'

export function useSkillFileData(
  appId: string,
  nodeId: string | null | undefined,
  mode: SkillFileDataMode,
) {
  const {
    data: fileContent,
    isLoading: isContentLoading,
    error: contentError,
  } = useQuery({
    ...appAssetFileContentOptions(appId, nodeId || ''),
    enabled: mode === 'content' && !!appId && !!nodeId,
  })

  const {
    data: downloadUrlData,
    isLoading: isDownloadUrlLoading,
    error: downloadUrlError,
  } = useQuery({
    ...appAssetFileDownloadUrlOptions(appId, nodeId || ''),
    enabled: mode === 'download' && !!appId && !!nodeId,
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
