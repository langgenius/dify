import type { ChatTreeUpdater, UpdateCurrentQAParams } from './types'
import type { ChatItemInTree } from '@/app/components/base/chat/types'
import { produce } from 'immer'
import { useCallback } from 'react'

export function useChatTreeOperations(updateChatTree: ChatTreeUpdater) {
  const produceChatTreeNode = useCallback(
    (tree: ChatItemInTree[], targetId: string, operation: (node: ChatItemInTree) => void) => {
      return produce(tree, (draft) => {
        const queue: ChatItemInTree[] = [...draft]
        while (queue.length > 0) {
          const current = queue.shift()!
          if (current.id === targetId) {
            operation(current)
            break
          }
          if (current.children)
            queue.push(...current.children)
        }
      })
    },
    [],
  )

  const updateCurrentQAOnTree = useCallback(({
    parentId,
    responseItem,
    placeholderQuestionId,
    questionItem,
  }: UpdateCurrentQAParams) => {
    const currentQA = { ...questionItem, children: [{ ...responseItem, children: [] }] } as ChatItemInTree
    updateChatTree((currentChatTree) => {
      if (!parentId) {
        const questionIndex = currentChatTree.findIndex(item => [placeholderQuestionId, questionItem.id].includes(item.id))
        return produce(currentChatTree, (draft) => {
          if (questionIndex === -1)
            draft.push(currentQA)
          else
            draft[questionIndex] = currentQA
        })
      }

      return produceChatTreeNode(currentChatTree, parentId, (parentNode) => {
        if (!parentNode.children)
          parentNode.children = []
        const questionNodeIndex = parentNode.children.findIndex(item => [placeholderQuestionId, questionItem.id].includes(item.id))
        if (questionNodeIndex === -1)
          parentNode.children.push(currentQA)
        else
          parentNode.children[questionNodeIndex] = currentQA
      })
    })
  }, [produceChatTreeNode, updateChatTree])

  return {
    produceChatTreeNode,
    updateCurrentQAOnTree,
  }
}
