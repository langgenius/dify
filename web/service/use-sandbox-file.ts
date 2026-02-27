import type {
  SandboxFileNode,
  SandboxFileTreeNode,
} from '@/types/sandbox-file'
import { skipToken, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useMemo } from 'react'
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

export function buildTreeFromFlatList(nodes: SandboxFileNode[]): SandboxFileTreeNode[] {
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

export function useSandboxFilesTree(appId: string | undefined) {
  const { data, isLoading, error } = useQuery(sandboxFilesTreeOptions(appId))

  const treeData = useMemo(() => {
    if (!data)
      return undefined
    return buildTreeFromFlatList(data)
  }, [data])

  return {
    data: treeData,
    flatData: data,
    hasFiles: (data?.length ?? 0) > 0,
    isLoading,
    error,
  }
}
