import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react'
import type { Dispatch, RefObject, SetStateAction } from 'react'
import type {
  Klass,
  LexicalCommand,
  LexicalEditor,
  LexicalNode,
  TextNode,
} from 'lexical'
import {
  $createTextNode,
  $getNodeByKey,
  $getSelection,
  $isDecoratorNode,
  $isNodeSelection,
  $isTextNode,
  COMMAND_PRIORITY_LOW,
  KEY_BACKSPACE_COMMAND,
  KEY_DELETE_COMMAND,
} from 'lexical'
import type { EntityMatch } from '@lexical/text'
import {
  mergeRegister,
} from '@lexical/utils'
import { useLexicalNodeSelection } from '@lexical/react/useLexicalNodeSelection'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { CustomTextNode } from './plugins/custom-text/node'
import { $isContextBlockNode } from './plugins/context-block/node'
import { DELETE_CONTEXT_BLOCK_COMMAND } from './plugins/context-block'
import { $isHistoryBlockNode } from './plugins/history-block/node'
import { DELETE_HISTORY_BLOCK_COMMAND } from './plugins/history-block'
import { $isQueryBlockNode } from './plugins/query-block/node'
import { DELETE_QUERY_BLOCK_COMMAND } from './plugins/query-block'

export type UseSelectOrDeleteHanlder = (nodeKey: string, command?: LexicalCommand<undefined>) => [RefObject<HTMLDivElement>, boolean]
export const useSelectOrDelete: UseSelectOrDeleteHanlder = (nodeKey: string, command?: LexicalCommand<undefined>) => {
  const ref = useRef<HTMLDivElement>(null)
  const [editor] = useLexicalComposerContext()
  const [isSelected, setSelected, clearSelection] = useLexicalNodeSelection(nodeKey)

  const handleDelete = useCallback(
    (event: KeyboardEvent) => {
      const selection = $getSelection()
      const nodes = selection?.getNodes()
      if (
        !isSelected
        && nodes?.length === 1
        && (
          ($isContextBlockNode(nodes[0]) && command === DELETE_CONTEXT_BLOCK_COMMAND)
          || ($isHistoryBlockNode(nodes[0]) && command === DELETE_HISTORY_BLOCK_COMMAND)
          || ($isQueryBlockNode(nodes[0]) && command === DELETE_QUERY_BLOCK_COMMAND)
        )
      )
        editor.dispatchCommand(command, undefined)

      if (isSelected && $isNodeSelection(selection)) {
        event.preventDefault()
        const node = $getNodeByKey(nodeKey)
        if ($isDecoratorNode(node)) {
          if (command)
            editor.dispatchCommand(command, undefined)

          node.remove()
        }
      }

      return false
    },
    [isSelected, nodeKey, command, editor],
  )

  const handleSelect = useCallback((e: MouseEvent) => {
    e.stopPropagation()
    clearSelection()
    setSelected(true)
  }, [setSelected, clearSelection])

  useEffect(() => {
    const ele = ref.current

    if (ele)
      ele.addEventListener('click', handleSelect)

    return () => {
      if (ele)
        ele.removeEventListener('click', handleSelect)
    }
  }, [handleSelect])
  useEffect(() => {
    return mergeRegister(
      editor.registerCommand(
        KEY_DELETE_COMMAND,
        handleDelete,
        COMMAND_PRIORITY_LOW,
      ),
      editor.registerCommand(
        KEY_BACKSPACE_COMMAND,
        handleDelete,
        COMMAND_PRIORITY_LOW,
      ),
    )
  }, [editor, clearSelection, handleDelete])

  return [ref, isSelected]
}

export type UseTriggerHandler = () => [RefObject<HTMLDivElement>, boolean, Dispatch<SetStateAction<boolean>>]
export const useTrigger: UseTriggerHandler = () => {
  const triggerRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const handleOpen = useCallback((e: MouseEvent) => {
    e.stopPropagation()
    setOpen(v => !v)
  }, [])

  useEffect(() => {
    const trigger = triggerRef.current
    if (trigger)
      trigger.addEventListener('click', handleOpen)

    return () => {
      if (trigger)
        trigger.removeEventListener('click', handleOpen)
    }
  }, [handleOpen])

  return [triggerRef, open, setOpen]
}

export function registerLexicalTextEntity<T extends TextNode>(
  editor: LexicalEditor,
  getMatch: (text: string) => null | EntityMatch,
  targetNode: Klass<T>,
  createNode: (textNode: TextNode) => T,
) {
  const isTargetNode = (node: LexicalNode | null | undefined): node is T => {
    return node instanceof targetNode
  }

  const replaceWithSimpleText = (node: TextNode): void => {
    const textNode = $createTextNode(node.getTextContent())
    textNode.setFormat(node.getFormat())
    node.replace(textNode)
  }

  const getMode = (node: TextNode): number => {
    return node.getLatest().__mode
  }

  const textNodeTransform = (node: TextNode) => {
    if (!node.isSimpleText())
      return

    const prevSibling = node.getPreviousSibling()
    let text = node.getTextContent()
    let currentNode = node
    let match

    if ($isTextNode(prevSibling)) {
      const previousText = prevSibling.getTextContent()
      const combinedText = previousText + text
      const prevMatch = getMatch(combinedText)

      if (isTargetNode(prevSibling)) {
        if (prevMatch === null || getMode(prevSibling) !== 0) {
          replaceWithSimpleText(prevSibling)
          return
        }
        else {
          const diff = prevMatch.end - previousText.length

          if (diff > 0) {
            const concatText = text.slice(0, diff)
            const newTextContent = previousText + concatText
            prevSibling.select()
            prevSibling.setTextContent(newTextContent)

            if (diff === text.length) {
              node.remove()
            }
            else {
              const remainingText = text.slice(diff)
              node.setTextContent(remainingText)
            }

            return
          }
        }
      }
      else if (prevMatch === null || prevMatch.start < previousText.length) {
        return
      }
    }

    while (true) {
      match = getMatch(text)
      let nextText = match === null ? '' : text.slice(match.end)
      text = nextText

      if (nextText === '') {
        const nextSibling = currentNode.getNextSibling()

        if ($isTextNode(nextSibling)) {
          nextText = currentNode.getTextContent() + nextSibling.getTextContent()
          const nextMatch = getMatch(nextText)

          if (nextMatch === null) {
            if (isTargetNode(nextSibling))
              replaceWithSimpleText(nextSibling)
            else
              nextSibling.markDirty()

            return
          }
          else if (nextMatch.start !== 0) {
            return
          }
        }
      }
      else {
        const nextMatch = getMatch(nextText)

        if (nextMatch !== null && nextMatch.start === 0)
          return
      }

      if (match === null)
        return

      if (match.start === 0 && $isTextNode(prevSibling) && prevSibling.isTextEntity())
        continue

      let nodeToReplace

      if (match.start === 0)
        [nodeToReplace, currentNode] = currentNode.splitText(match.end)
      else
        [, nodeToReplace, currentNode] = currentNode.splitText(match.start, match.end)

      const replacementNode = createNode(nodeToReplace)
      replacementNode.setFormat(nodeToReplace.getFormat())
      nodeToReplace.replace(replacementNode)

      if (currentNode == null)
        return
    }
  }

  const reverseNodeTransform = (node: T) => {
    const text = node.getTextContent()
    const match = getMatch(text)

    if (match === null || match.start !== 0) {
      replaceWithSimpleText(node)
      return
    }

    if (text.length > match.end) {
      // This will split out the rest of the text as simple text
      node.splitText(match.end)
      return
    }

    const prevSibling = node.getPreviousSibling()

    if ($isTextNode(prevSibling) && prevSibling.isTextEntity()) {
      replaceWithSimpleText(prevSibling)
      replaceWithSimpleText(node)
    }

    const nextSibling = node.getNextSibling()

    if ($isTextNode(nextSibling) && nextSibling.isTextEntity()) {
      replaceWithSimpleText(nextSibling) // This may have already been converted in the previous block

      if (isTargetNode(node))
        replaceWithSimpleText(node)
    }
  }

  const removePlainTextTransform = editor.registerNodeTransform(CustomTextNode, textNodeTransform)
  const removeReverseNodeTransform = editor.registerNodeTransform(targetNode, reverseNodeTransform)
  return [removePlainTextTransform, removeReverseNodeTransform]
}

export function useLexicalTextEntity<T extends TextNode>(
  getMatch: (text: string) => null | EntityMatch,
  targetNode: Klass<T>,
  createNode: (textNode: TextNode) => T,
) {
  const [editor] = useLexicalComposerContext()

  useEffect(() => {
    return mergeRegister(...registerLexicalTextEntity(editor, getMatch, targetNode, createNode))
  }, [createNode, editor, getMatch, targetNode])
}
