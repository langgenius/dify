import { useEffect, useRef } from 'react'
import {
  $getSelection,
  COMMAND_PRIORITY_EDITOR,
  createCommand,
} from 'lexical'
import { mergeRegister } from '@lexical/utils'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import {
  $createContextBlockNode,
  ContextBlockNode,
} from './node'

export const INSERT_CONTEXT_BLOCK_COMMAND = createCommand()

const ContextBlock = () => {
  const nodeKeyRef = useRef('')
  const [editor] = useLexicalComposerContext()

  useEffect(() => {
    if (!editor.hasNodes([ContextBlockNode]))
      throw new Error('ContextBlockPlugin: ContextBlock not registered on editor')

    return mergeRegister(
      editor.registerCommand(
        INSERT_CONTEXT_BLOCK_COMMAND,
        () => {
          const contextBlockNode = $createContextBlockNode()
          nodeKeyRef.current = contextBlockNode.getKey()
          const selection = $getSelection()

          selection?.insertNodes([contextBlockNode])

          return true
        },
        COMMAND_PRIORITY_EDITOR,
      ),
    )
  }, [editor])

  return null
}

export default ContextBlock
