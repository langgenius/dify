import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react'
import type { Dispatch, RefObject, SetStateAction } from 'react'
import {
  $getNodeByKey,
  $getSelection,
  $isDecoratorNode,
  $isNodeSelection,
  COMMAND_PRIORITY_LOW,
  KEY_BACKSPACE_COMMAND,
  KEY_DELETE_COMMAND,
} from 'lexical'
import {
  mergeRegister,
} from '@lexical/utils'
import { useLexicalNodeSelection } from '@lexical/react/useLexicalNodeSelection'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'

export type UseSelectOrDeleteHanlder = (nodeKey: string) => [RefObject<HTMLDivElement>, boolean]
export const useSelectOrDelete: UseSelectOrDeleteHanlder = (nodeKey: string) => {
  const ref = useRef<HTMLDivElement>(null)
  const [editor] = useLexicalComposerContext()
  const [isSelected, setSelected, clearSelection] = useLexicalNodeSelection(nodeKey)

  const onDelete = useCallback(
    (event: KeyboardEvent) => {
      if (isSelected && $isNodeSelection($getSelection())) {
        event.preventDefault()
        const node = $getNodeByKey(nodeKey)
        if ($isDecoratorNode(node))
          node.remove()
      }

      return false
    },
    [isSelected, nodeKey],
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
        onDelete,
        COMMAND_PRIORITY_LOW,
      ),
      editor.registerCommand(
        KEY_BACKSPACE_COMMAND,
        onDelete,
        COMMAND_PRIORITY_LOW,
      ),
    )
  }, [editor, clearSelection, onDelete])

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
