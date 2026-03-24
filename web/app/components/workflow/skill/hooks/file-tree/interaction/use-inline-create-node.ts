'use client'

import type { NodeApi, TreeApi } from 'react-arborist'
import type { TreeNodeData } from '../../../type'
import { useCallback, useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useStore as useAppStore } from '@/app/components/app/store'
import { toast } from '@/app/components/base/ui/toast'
import { useStore, useWorkflowStore } from '@/app/components/workflow/store'
import {
  useCreateAppAssetFolder,
  useRenameAppAssetNode,
  useUploadFileWithPresignedUrl,
} from '@/service/use-app-asset'
import { getFileExtension, isTextLikeFile } from '../../../utils/file-utils'
import { createDraftTreeNode, insertDraftTreeNode } from '../../../utils/tree-utils'
import { useSkillTreeUpdateEmitter } from '../data/use-skill-tree-collaboration'

type UseInlineCreateNodeOptions = {
  treeRef: React.RefObject<TreeApi<TreeNodeData> | null>
  treeChildren: TreeNodeData[]
}

type RenamePayload = {
  id: string
  name: string
}

type MutationWithCallbacks<TData, TVariables> = {
  mutate: (variables: TVariables, options?: {
    onSuccess?: (data: TData) => void
    onError?: () => void
  }) => void
}

type MutationResult<TData> = { ok: true, data: TData } | { ok: false }

export function useInlineCreateNode({
  treeRef,
  treeChildren,
}: UseInlineCreateNodeOptions) {
  const { t } = useTranslation('workflow')
  const appDetail = useAppStore(s => s.appDetail)
  const appId = appDetail?.id || ''
  const pendingCreateNode = useStore(s => s.pendingCreateNode)
  const storeApi = useWorkflowStore()

  const uploadFile = useUploadFileWithPresignedUrl()
  const createFolder = useCreateAppAssetFolder()
  const renameNode = useRenameAppAssetNode()
  const emitTreeUpdate = useSkillTreeUpdateEmitter()

  const pendingCreateId = pendingCreateNode?.id ?? null
  const pendingCreateType = pendingCreateNode?.nodeType ?? null
  const pendingCreateParentId = pendingCreateNode?.parentId ?? null
  const hasPendingCreate = !!pendingCreateNode

  const treeNodes = useMemo(() => {
    if (!pendingCreateNode)
      return treeChildren
    const draftNode = createDraftTreeNode({
      id: pendingCreateNode.id,
      nodeType: pendingCreateNode.nodeType,
    })
    return insertDraftTreeNode(treeChildren, pendingCreateNode.parentId, draftNode)
  }, [pendingCreateNode, treeChildren])

  const runMutation = useCallback(<TData, TVariables>(
    mutation: MutationWithCallbacks<TData, TVariables>,
    variables: TVariables,
  ) => {
    return new Promise<MutationResult<TData>>((resolve) => {
      mutation.mutate(variables, {
        onSuccess: data => resolve({ ok: true, data }),
        onError: () => resolve({ ok: false }),
      })
    })
  }, [])

  const handleRename = useCallback(async ({ id, name }: RenamePayload) => {
    if (pendingCreateId && id === pendingCreateId) {
      const trimmedName = name.trim()
      if (!trimmedName) {
        storeApi.getState().clearCreateNode()
        return
      }

      try {
        if (pendingCreateType === 'folder') {
          const createFolderResult = await runMutation(createFolder, {
            appId,
            payload: {
              name: trimmedName,
              parent_id: pendingCreateParentId,
            },
          })
          if (!createFolderResult.ok) {
            toast.error(t('skillSidebar.menu.createError'))
            return
          }
          emitTreeUpdate()
          toast.success(t('skillSidebar.menu.folderCreated'))
        }
        else {
          const emptyBlob = new Blob([''], { type: 'text/plain' })
          const file = new File([emptyBlob], trimmedName)
          const createFileResult = await runMutation(uploadFile, {
            appId,
            file,
            parentId: pendingCreateParentId,
          })
          if (!createFileResult.ok) {
            toast.error(t('skillSidebar.menu.createError'))
            return
          }
          emitTreeUpdate()
          const extension = getFileExtension(trimmedName, createFileResult.data.extension)
          if (isTextLikeFile(extension))
            storeApi.getState().openTab(createFileResult.data.id, { pinned: true, autoFocusEditor: true })
          toast.success(t('skillSidebar.menu.fileCreated'))
        }
      }
      finally {
        storeApi.getState().clearCreateNode()
      }
      return
    }

    const renameResult = await runMutation(renameNode, {
      appId,
      nodeId: id,
      payload: { name },
    })

    if (renameResult.ok) {
      emitTreeUpdate()
      toast.success(t('skillSidebar.menu.renamed'))
    }
    else {
      toast.error(t('skillSidebar.menu.renameError'))
    }
  }, [
    appId,
    uploadFile,
    createFolder,
    pendingCreateId,
    pendingCreateParentId,
    pendingCreateType,
    renameNode,
    runMutation,
    storeApi,
    t,
    emitTreeUpdate,
  ])

  const searchMatch = useCallback(
    (node: NodeApi<TreeNodeData>, term: string) => {
      if (pendingCreateId && node.data.id === pendingCreateId)
        return true
      return node.data.name.toLowerCase().includes(term.toLowerCase())
    },
    [pendingCreateId],
  )

  useEffect(() => {
    if (!pendingCreateId)
      return

    const tree = treeRef.current
    if (!tree)
      return

    const frame = requestAnimationFrame(() => {
      const currentTree = treeRef.current
      if (!currentTree)
        return
      currentTree.openParents(pendingCreateId)
      currentTree.edit(pendingCreateId).then((result) => {
        if (result.cancelled && storeApi.getState().pendingCreateNode?.id === pendingCreateId)
          storeApi.getState().clearCreateNode()
      })
    })

    return () => cancelAnimationFrame(frame)
  }, [pendingCreateId, storeApi, treeRef])

  return {
    treeNodes,
    handleRename,
    searchMatch,
    hasPendingCreate,
  }
}
