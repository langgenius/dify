import type {
  SandboxFileListQuery,
  SandboxFileNode,
  SandboxFileTreeNode,
} from '@/types/sandbox-file'
import {
  useMutation,
  useQuery,
} from '@tanstack/react-query'
import { useMemo } from 'react'
import { consoleClient, consoleQuery } from '@/service/client'

type UseGetSandboxFilesOptions = {
  path?: string
  recursive?: boolean
  enabled?: boolean
  refetchInterval?: number | false
}

export function useGetSandboxFiles(
  sandboxId: string | undefined,
  options?: UseGetSandboxFilesOptions,
) {
  const query: SandboxFileListQuery = {
    path: options?.path,
    recursive: options?.recursive,
  }

  return useQuery({
    queryKey: consoleQuery.sandboxFile.listFiles.queryKey({
      input: { params: { sandboxId: sandboxId! }, query },
    }),
    queryFn: () => consoleClient.sandboxFile.listFiles({
      params: { sandboxId: sandboxId! },
      query,
    }),
    enabled: !!sandboxId && (options?.enabled ?? true),
    refetchInterval: options?.refetchInterval,
  })
}

export function useDownloadSandboxFile(sandboxId: string | undefined) {
  return useMutation({
    mutationKey: consoleQuery.sandboxFile.downloadFile.mutationKey(),
    mutationFn: (path: string) => {
      if (!sandboxId)
        throw new Error('sandboxId is required')
      return consoleClient.sandboxFile.downloadFile({
        params: { sandboxId },
        body: { path },
      })
    },
  })
}

export function useSandboxFileDownloadUrl(
  sandboxId: string | undefined,
  path: string | undefined,
) {
  return useQuery({
    queryKey: ['sandboxFileDownloadUrl', sandboxId, path],
    queryFn: () => consoleClient.sandboxFile.downloadFile({
      params: { sandboxId: sandboxId! },
      body: { path: path! },
    }),
    enabled: !!sandboxId && !!path,
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
  sandboxId: string | undefined,
  options?: UseGetSandboxFilesOptions,
) {
  const { data, isLoading, error, refetch } = useGetSandboxFiles(sandboxId, {
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
