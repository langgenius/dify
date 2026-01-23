import type {
  AppAssetNode,
  AppAssetTreeResponse,
  BatchUploadNodeInput,
  BatchUploadNodeOutput,
  CreateFolderPayload,
  GetFileUploadUrlPayload,
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
import { uploadToPresignedUrl } from './upload-to-presigned-url'

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

export const useUploadFileWithPresignedUrl = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationKey: consoleQuery.appAsset.getFileUploadUrl.mutationKey(),
    mutationFn: async ({
      appId,
      file,
      parentId,
      onProgress,
    }: {
      appId: string
      file: File
      parentId?: string | null
      onProgress?: (progress: number) => void
    }): Promise<AppAssetNode> => {
      const payload: GetFileUploadUrlPayload = {
        name: file.name,
        size: file.size,
        parent_id: parentId,
      }

      const { node, upload_url } = await consoleClient.appAsset.getFileUploadUrl({
        params: { appId },
        body: payload,
      })

      await uploadToPresignedUrl({
        file,
        uploadUrl: upload_url,
        onProgress,
      })

      return node
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: consoleQuery.appAsset.tree.queryKey({ input: { params: { appId: variables.appId } } }),
      })
    },
  })
}

export const useBatchUpload = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationKey: consoleQuery.appAsset.batchUpload.mutationKey(),
    mutationFn: async ({
      appId,
      tree,
      files,
      onProgress,
    }: {
      appId: string
      tree: BatchUploadNodeInput[]
      files: Map<string, File>
      onProgress?: (uploaded: number, total: number) => void
    }): Promise<void> => {
      const response = await consoleClient.appAsset.batchUpload({
        params: { appId },
        body: { children: tree },
      })

      const uploadTasks: Array<{ path: string, file: File, url: string }> = []

      const extractUploads = (nodes: BatchUploadNodeOutput[], pathPrefix: string = '') => {
        for (const node of nodes) {
          const currentPath = pathPrefix ? `${pathPrefix}/${node.name}` : node.name
          if (node.upload_url) {
            const file = files.get(currentPath)
            if (file)
              uploadTasks.push({ path: currentPath, file, url: node.upload_url })
          }
          if (node.children && node.children.length > 0)
            extractUploads(node.children, currentPath)
        }
      }

      extractUploads(response.children)

      let completed = 0
      const total = uploadTasks.length

      await Promise.all(
        uploadTasks.map(async (task) => {
          await uploadToPresignedUrl({
            file: task.file,
            uploadUrl: task.url,
          })
          completed++
          onProgress?.(completed, total)
        }),
      )
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: consoleQuery.appAsset.tree.queryKey({ input: { params: { appId: variables.appId } } }),
      })
    },
  })
}
