import type {
  AppAssetNode,
  AppAssetTreeResponse,
  CreateFolderPayload,
  MoveNodePayload,
  RenameNodePayload,
  ReorderNodePayload,
  UpdateFileContentPayload,
} from '@/types/app-asset'
import {
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { consoleClient, consoleQuery } from '@/service/client'
import { upload } from './base'

type UseGetAppAssetTreeOptions<TData = AppAssetTreeResponse> = {
  select?: (data: AppAssetTreeResponse) => TData
}

export function useGetAppAssetTree<TData = AppAssetTreeResponse>(
  appId: string,
  options?: UseGetAppAssetTreeOptions<TData>,
) {
  return useQuery({
    queryKey: consoleQuery.appAsset.tree.queryKey({ input: { params: { appId } } }),
    queryFn: () => consoleClient.appAsset.tree({ params: { appId } }),
    enabled: !!appId,
    select: options?.select,
  })
}

export const useCreateAppAssetFolder = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationKey: consoleQuery.appAsset.createFolder.mutationKey(),
    mutationFn: ({ appId, payload }: { appId: string, payload: CreateFolderPayload }) => {
      return consoleClient.appAsset.createFolder({
        params: { appId },
        body: payload,
      })
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: consoleQuery.appAsset.tree.queryKey({ input: { params: { appId: variables.appId } } }),
      })
    },
  })
}

export const useCreateAppAssetFile = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationKey: consoleQuery.appAsset.createFile.mutationKey(),
    mutationFn: async ({
      appId,
      name,
      file,
      parentId,
      onProgress,
    }: {
      appId: string
      name: string
      file: File
      parentId?: string | null
      onProgress?: (progress: number) => void
    }): Promise<AppAssetNode> => {
      const formData = new FormData()
      formData.append('name', name)
      formData.append('file', file)
      if (parentId)
        formData.append('parent_id', parentId)

      const xhr = new XMLHttpRequest()
      return upload(
        {
          xhr,
          data: formData,
          onprogress: onProgress
            ? (e) => {
                if (e.lengthComputable)
                  onProgress(Math.round((e.loaded / e.total) * 100))
              }
            : undefined,
        },
        false,
        `/apps/${appId}/assets/files`,
      ) as Promise<AppAssetNode>
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: consoleQuery.appAsset.tree.queryKey({ input: { params: { appId: variables.appId } } }),
      })
    },
  })
}

export const useGetAppAssetFileContent = (appId: string, nodeId: string, options?: { enabled?: boolean }) => {
  return useQuery({
    queryKey: consoleQuery.appAsset.getFileContent.queryKey({ input: { params: { appId, nodeId } } }),
    queryFn: () => consoleClient.appAsset.getFileContent({ params: { appId, nodeId } }),
    select: (data) => {
      try {
        const result = JSON.parse(data.content)
        return result
      }
      catch {
        return { content: data.content }
      }
    },
    enabled: (options?.enabled ?? true) && !!appId && !!nodeId,
  })
}

export const useGetAppAssetFileDownloadUrl = (appId: string, nodeId: string, options?: { enabled?: boolean }) => {
  return useQuery({
    queryKey: consoleQuery.appAsset.getFileDownloadUrl.queryKey({ input: { params: { appId, nodeId } } }),
    queryFn: () => consoleClient.appAsset.getFileDownloadUrl({ params: { appId, nodeId } }),
    enabled: (options?.enabled ?? true) && !!appId && !!nodeId,
  })
}

export const useUpdateAppAssetFileContent = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationKey: consoleQuery.appAsset.updateFileContent.mutationKey(),
    mutationFn: ({
      appId,
      nodeId,
      payload,
    }: {
      appId: string
      nodeId: string
      payload: UpdateFileContentPayload
    }) => {
      return consoleClient.appAsset.updateFileContent({
        params: { appId, nodeId },
        body: { content: JSON.stringify(payload) },
      })
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: consoleQuery.appAsset.tree.queryKey({ input: { params: { appId: variables.appId } } }),
      })
      queryClient.invalidateQueries({
        queryKey: consoleQuery.appAsset.getFileContent.queryKey({
          input: { params: { appId: variables.appId, nodeId: variables.nodeId } },
        }),
      })
    },
  })
}

export const useUpdateAppAssetFileByUpload = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({
      appId,
      nodeId,
      file,
      onProgress,
    }: {
      appId: string
      nodeId: string
      file: File
      onProgress?: (progress: number) => void
    }): Promise<AppAssetNode> => {
      const formData = new FormData()
      formData.append('file', file)

      const xhr = new XMLHttpRequest()
      return upload(
        {
          xhr,
          method: 'PUT',
          data: formData,
          onprogress: onProgress
            ? (e) => {
                if (e.lengthComputable)
                  onProgress(Math.round((e.loaded / e.total) * 100))
              }
            : undefined,
        },
        false,
        `/apps/${appId}/assets/files/${nodeId}`,
      ) as Promise<AppAssetNode>
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: consoleQuery.appAsset.tree.queryKey({ input: { params: { appId: variables.appId } } }),
      })
      queryClient.invalidateQueries({
        queryKey: consoleQuery.appAsset.getFileContent.queryKey({
          input: { params: { appId: variables.appId, nodeId: variables.nodeId } },
        }),
      })
    },
  })
}

export const useDeleteAppAssetNode = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationKey: consoleQuery.appAsset.deleteNode.mutationKey(),
    mutationFn: ({ appId, nodeId }: { appId: string, nodeId: string }) => {
      return consoleClient.appAsset.deleteNode({
        params: { appId, nodeId },
      })
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: consoleQuery.appAsset.tree.queryKey({ input: { params: { appId: variables.appId } } }),
      })
    },
  })
}

export const useRenameAppAssetNode = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationKey: consoleQuery.appAsset.renameNode.mutationKey(),
    mutationFn: ({
      appId,
      nodeId,
      payload,
    }: {
      appId: string
      nodeId: string
      payload: RenameNodePayload
    }) => {
      return consoleClient.appAsset.renameNode({
        params: { appId, nodeId },
        body: payload,
      })
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: consoleQuery.appAsset.tree.queryKey({ input: { params: { appId: variables.appId } } }),
      })
    },
  })
}

export const useMoveAppAssetNode = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationKey: consoleQuery.appAsset.moveNode.mutationKey(),
    mutationFn: ({
      appId,
      nodeId,
      payload,
    }: {
      appId: string
      nodeId: string
      payload: MoveNodePayload
    }) => {
      return consoleClient.appAsset.moveNode({
        params: { appId, nodeId },
        body: payload,
      })
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: consoleQuery.appAsset.tree.queryKey({ input: { params: { appId: variables.appId } } }),
      })
    },
  })
}

export const useReorderAppAssetNode = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationKey: consoleQuery.appAsset.reorderNode.mutationKey(),
    mutationFn: ({
      appId,
      nodeId,
      payload,
    }: {
      appId: string
      nodeId: string
      payload: ReorderNodePayload
    }) => {
      return consoleClient.appAsset.reorderNode({
        params: { appId, nodeId },
        body: payload,
      })
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: consoleQuery.appAsset.tree.queryKey({ input: { params: { appId: variables.appId } } }),
      })
    },
  })
}

export const usePublishAppAssets = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationKey: consoleQuery.appAsset.publish.mutationKey(),
    mutationFn: (appId: string) => {
      return consoleClient.appAsset.publish({
        params: { appId },
      })
    },
    onSuccess: (_, appId) => {
      queryClient.invalidateQueries({
        queryKey: consoleQuery.appAsset.tree.queryKey({ input: { params: { appId } } }),
      })
    },
  })
}
