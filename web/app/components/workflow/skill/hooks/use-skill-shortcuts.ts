'use client'

import type { RefObject } from 'react'
import type { TreeApi } from 'react-arborist'
import type { TreeNodeData } from '../type'
import { useKeyPress } from 'ahooks'
import { useCallback, useEffect, useRef } from 'react'
import { useWorkflowStore } from '@/app/components/workflow/store'
import {
  getKeyboardKeyCodeBySystem,
  isEventTargetInputArea,
} from '@/app/components/workflow/utils/common'

type UseSkillShortcutsOptions = {
  treeRef: RefObject<TreeApi<TreeNodeData> | null>
  enabled?: boolean
}

const TREE_CONTAINER_SELECTOR = '[data-skill-tree-container]'

export function useSkillShortcuts({
  treeRef,
  enabled = true,
}: UseSkillShortcutsOptions): void {
  const storeApi = useWorkflowStore()
  const enabledRef = useRef(enabled)
  useEffect(() => {
    enabledRef.current = enabled
  }, [enabled])

  const shouldHandle = useCallback((e: KeyboardEvent) => {
    if (!enabledRef.current)
      return false
    if (isEventTargetInputArea(e.target as HTMLElement))
      return false
    const target = e.target as HTMLElement
    const isInTreeContainer = target.closest(TREE_CONTAINER_SELECTOR) !== null
    const hasSelection = (treeRef.current?.selectedNodes.length ?? 0) > 0
    return isInTreeContainer || hasSelection
  }, [treeRef])

  const getSelectedNodeIds = useCallback(() => {
    const tree = treeRef.current
    if (!tree)
      return []
    return tree.selectedNodes.map(n => n.id)
  }, [treeRef])

  useKeyPress(`${getKeyboardKeyCodeBySystem('ctrl')}.x`, (e) => {
    if (shouldHandle(e)) {
      const nodeIds = getSelectedNodeIds()
      if (nodeIds.length > 0) {
        e.preventDefault()
        storeApi.getState().cutNodes(nodeIds)
      }
    }
  }, { exactMatch: true, useCapture: true })

  useKeyPress(`${getKeyboardKeyCodeBySystem('ctrl')}.v`, (e) => {
    if (shouldHandle(e) && storeApi.getState().hasClipboard()) {
      e.preventDefault()
      window.dispatchEvent(new CustomEvent('skill:paste'))
    }
  }, { exactMatch: true, useCapture: true })
}
