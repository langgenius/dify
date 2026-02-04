import type {
  SandboxFileListQuery,
  SandboxFileNode,
  SandboxFileTreeNode,
} from '@/types/sandbox-file'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useMemo } from 'react'
import { consoleClient, consoleQuery } from '@/service/client'

type UseGetSandboxFilesOptions = {
  path?: string
  recursive?: boolean
  enabled?: boolean
  refetchInterval?: number | false
}

export function useGetSandboxFiles(
  appId: string | undefined,
  options?: UseGetSandboxFilesOptions,
) {
  const query: SandboxFileListQuery = {
    path: options?.path,
    recursive: options?.recursive,
  }

  return useQuery({
    queryKey: consoleQuery.sandboxFile.listFiles.queryKey({
      input: { params: { appId: appId! }, query },
    }),
    queryFn: () => consoleClient.sandboxFile.listFiles({
      params: { appId: appId! },
      query,
    }),
    enabled: !!appId && (options?.enabled ?? true),
    refetchInterval: options?.refetchInterval,
  })
}

export function useSandboxFileDownloadUrl(
  appId: string | undefined,
  path: string | undefined,
) {
  return useQuery({
    queryKey: consoleQuery.sandboxFile.downloadFile.queryKey({
      input: { params: { appId: appId! }, body: { path: path! } },
    }),
    queryFn: () => consoleClient.sandboxFile.downloadFile({
      params: { appId: appId! },
      body: { path: path! },
    }),
    enabled: !!appId && !!path,
  })
}

export function useInvalidateSandboxFiles() {
  const queryClient = useQueryClient()
  return useCallback(() => {
    queryClient.invalidateQueries({
      queryKey: consoleQuery.sandboxFile.listFiles.key(),
    })
    queryClient.invalidateQueries({
      queryKey: consoleQuery.sandboxFile.downloadFile.key(),
    })
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

function buildTreeFromFlatList(nodes: SandboxFileNode[]): SandboxFileTreeNode[] {
  const nodeMap = new Map<string, SandboxFileTreeNode>()
  const roots: SandboxFileTreeNode[] = []

  const sorted = [...nodes].sort((a, b) =>
    a.path.split('/').length - b.path.split('/').length,
  )

  for (const node of sorted) {
    const parts = node.path.split('/')
    const name = parts[parts.length - 1]
    const parentPath = parts.slice(0, -1).join('/')

    const treeNode: SandboxFileTreeNode = {
      id: node.path,
      name,
      path: node.path,
      node_type: node.is_dir ? 'folder' : 'file',
      size: node.size,
      mtime: node.mtime,
      extension: node.extension,
      children: [],
    }

    nodeMap.set(node.path, treeNode)

    if (parentPath === '') {
      roots.push(treeNode)
    }
    else {
      const parent = nodeMap.get(parentPath)
      if (parent)
        parent.children.push(treeNode)
    }
  }

  return roots
}

export function useSandboxFilesTree(
  appId: string | undefined,
  options?: UseGetSandboxFilesOptions,
) {
  const { data, isLoading, error, refetch } = useGetSandboxFiles(appId, {
    ...options,
    recursive: true,
  })

  const treeData = useMemo(() => {
    if (!data)
      return undefined
    return buildTreeFromFlatList(data)
  }, [data])

  const hasFiles = useMemo(() => {
    return (data?.length ?? 0) > 0
  }, [data])

  return {
    data: treeData,
    flatData: data,
    hasFiles,
    isLoading,
    error,
    refetch,
  }
}
