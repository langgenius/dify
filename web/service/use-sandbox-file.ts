import { skipToken, useMutation, useQueryClient } from '@tanstack/react-query'
import { useCallback } from 'react'
import { consoleClient, consoleQuery } from '@/service/client'

export function sandboxFileDownloadUrlOptions(appId: string | undefined, path: string | undefined) {
  return consoleQuery.sandboxFile.downloadFile.queryOptions({
    input: appId && path
      ? { params: { appId }, body: { path } }
      : skipToken,
  })
}

export function sandboxFilesTreeOptions(appId: string | undefined) {
  return consoleQuery.sandboxFile.listFiles.queryOptions({
    input: appId
      ? { params: { appId }, query: { recursive: true } }
      : skipToken,
  })
}

type InvalidateSandboxFilesOptions = {
  refetchDownloadFile?: boolean
}

export function useInvalidateSandboxFiles() {
  const queryClient = useQueryClient()
  return useCallback((options?: InvalidateSandboxFilesOptions) => {
    const shouldRefetchDownloadFile = options?.refetchDownloadFile ?? true
    return Promise.all([
      queryClient.invalidateQueries({
        queryKey: consoleQuery.sandboxFile.listFiles.key(),
      }),
      queryClient.invalidateQueries({
        queryKey: consoleQuery.sandboxFile.downloadFile.key(),
        ...(shouldRefetchDownloadFile ? {} : { refetchType: 'none' as const }),
      }),
    ])
  }, [queryClient])
}

export function useDownloadSandboxFile(appId: string | undefined) {
  return useMutation({
    mutationFn: (path: string) => {
      if (!appId)
        throw new Error('appId is required')
      return consoleClient.sandboxFile.downloadFile({
        params: { appId },
        body: { path },
      })
    },
  })
}
