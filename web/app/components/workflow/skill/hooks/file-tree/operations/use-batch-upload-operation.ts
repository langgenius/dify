'use client'

import type { BatchUploadNodeInput, BatchUploadNodeOutput } from '@/types/app-asset'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { consoleClient, consoleQuery } from '@/service/client'
import { uploadToPresignedUrl } from '@/service/upload-to-presigned-url'
import { useBatchUpload } from '@/service/use-app-asset'

type BatchUploadOperationVariables = {
  appId: string
  tree: BatchUploadNodeInput[]
  files: Map<string, File>
  parentId?: string | null
  onProgress?: (uploaded: number, total: number) => void
}

type BatchUploadTask = {
  file: File
  url: string
}

const uploadBatchUploadTasks = async ({
  tasks,
  onProgress,
}: {
  tasks: BatchUploadTask[]
  onProgress?: (uploaded: number, total: number) => void
}) => {
  let completed = 0
  const total = tasks.length

  await Promise.all(
    tasks.map(async (task) => {
      await uploadToPresignedUrl({
        file: task.file,
        uploadUrl: task.url,
      })
      completed++
      onProgress?.(completed, total)
    }),
  )
}

const createBatchUploadTreeInParent = async ({
  appId,
  tree,
  files,
  parentId,
  pathPrefix = '',
}: {
  appId: string
  tree: BatchUploadNodeInput[]
  files: Map<string, File>
  parentId: string
  pathPrefix?: string
}): Promise<{ nodes: BatchUploadNodeOutput[], tasks: BatchUploadTask[] }> => {
  const nodes: BatchUploadNodeOutput[] = []
  const tasks: BatchUploadTask[] = []

  for (const inputNode of tree) {
    const sourcePath = pathPrefix ? `${pathPrefix}/${inputNode.name}` : inputNode.name

    if (inputNode.node_type === 'folder') {
      const folder = await consoleClient.appAsset.createFolder({
        params: { appId },
        body: { name: inputNode.name, parent_id: parentId },
      })

      const childrenResult = await createBatchUploadTreeInParent({
        appId,
        tree: inputNode.children ?? [],
        files,
        parentId: folder.id,
        pathPrefix: sourcePath,
      })

      nodes.push({
        id: folder.id,
        name: folder.name,
        node_type: folder.node_type,
        size: folder.size,
        children: childrenResult.nodes,
      })
      tasks.push(...childrenResult.tasks)
      continue
    }

    const file = files.get(sourcePath)
    if (!file)
      throw new Error(`Missing file for batch upload path: ${sourcePath}`)

    const { node, upload_url } = await consoleClient.appAsset.getFileUploadUrl({
      params: { appId },
      body: {
        name: inputNode.name,
        size: inputNode.size ?? file.size,
        parent_id: parentId,
      },
    })

    nodes.push({
      id: node.id,
      name: node.name,
      node_type: node.node_type,
      size: node.size,
      children: [],
      upload_url,
    })
    tasks.push({ file, url: upload_url })
  }

  return { nodes, tasks }
}

export function useBatchUploadOperation() {
  const queryClient = useQueryClient()
  const batchUpload = useBatchUpload()

  return useMutation({
    mutationKey: consoleQuery.appAsset.batchUpload.mutationKey(),
    mutationFn: async (variables: BatchUploadOperationVariables): Promise<BatchUploadNodeOutput[]> => {
      if (!variables.parentId)
        return batchUpload.mutateAsync(variables)

      try {
        const result = await createBatchUploadTreeInParent({
          appId: variables.appId,
          tree: variables.tree,
          files: variables.files,
          parentId: variables.parentId,
        })

        await uploadBatchUploadTasks({
          tasks: result.tasks,
          onProgress: variables.onProgress,
        })

        return result.nodes
      }
      finally {
        await queryClient.invalidateQueries({
          queryKey: consoleQuery.appAsset.tree.key({ type: 'query', input: { params: { appId: variables.appId } } }),
        })
      }
    },
  })
}
