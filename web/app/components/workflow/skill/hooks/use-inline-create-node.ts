'use client'

import type { NodeApi, TreeApi } from 'react-arborist'
import type { TreeNodeData } from '../type'
import { useCallback, useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useStore as useAppStore } from '@/app/components/app/store'
import Toast from '@/app/components/base/toast'
import { useStore, useWorkflowStore } from '@/app/components/workflow/store'
import {
  useCreateAppAssetFile,
  useCreateAppAssetFolder,
  useRenameAppAssetNode,
} from '@/service/use-app-asset'
import { getFileExtension, isTextLikeFile } from '../utils/file-utils'
import { createDraftTreeNode, insertDraftTreeNode } from '../utils/tree-utils'

type UseInlineCreateNodeOptions = {
  treeRef: React.RefObject<TreeApi<TreeNodeData> | null>
  treeChildren: TreeNodeData[]
}

type RenamePayload = {
  id: string
  name: string
}

export function useInlineCreateNode({
  treeRef,
  treeChildren,
}: UseInlineCreateNodeOptions) {
  const { t } = useTranslation('workflow')
  const appDetail = useAppStore(s => s.appDetail)
  const appId = appDetail?.id || ''
  const pendingCreateNode = useStore(s => s.pendingCreateNode)
  const storeApi = useWorkflowStore()

  const createFile = useCreateAppAssetFile()
  const createFolder = useCreateAppAssetFolder()
  const renameNode = useRenameAppAssetNode()

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

  const handleRename = useCallback(async ({ id, name }: RenamePayload) => {
    if (pendingCreateId && id === pendingCreateId) {
      const trimmedName = name.trim()
      if (!trimmedName) {
        storeApi.getState().clearCreateNode()
        return
      }

      try {
        if (pendingCreateType === 'folder') {
          await createFolder.mutateAsync({
            appId,
            payload: {
              name: trimmedName,
              parent_id: pendingCreateParentId,
            },
          })
          Toast.notify({
            type: 'success',
            message: t('skillSidebar.menu.folderCreated'),
          })
        }
        else {
          const emptyBlob = new Blob([''], { type: 'text/plain' })
          const file = new File([emptyBlob], trimmedName)
          const createdFile = await createFile.mutateAsync({
            appId,
            name: trimmedName,
            file,
            parentId: pendingCreateParentId,
          })
          const extension = getFileExtension(trimmedName, createdFile.extension)
          if (isTextLikeFile(extension))
            storeApi.getState().openTab(createdFile.id, { pinned: true })
          Toast.notify({
            type: 'success',
            message: t('skillSidebar.menu.fileCreated'),
          })
        }
      }
      catch {
        Toast.notify({
          type: 'error',
          message: t('skillSidebar.menu.createError'),
        })
      }
      finally {
        storeApi.getState().clearCreateNode()
      }
      return
    }

    renameNode.mutateAsync({
      appId,
      nodeId: id,
      payload: { name },
    }).then(() => {
      Toast.notify({
        type: 'success',
        message: t('skillSidebar.menu.renamed'),
      })
    }).catch(() => {
      Toast.notify({
        type: 'error',
        message: t('skillSidebar.menu.renameError'),
      })
    })
  }, [
    appId,
    createFile,
    createFolder,
    pendingCreateId,
    pendingCreateParentId,
    pendingCreateType,
    renameNode,
    storeApi,
    t,
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
