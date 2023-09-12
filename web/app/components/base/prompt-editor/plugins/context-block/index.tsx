import { useEffect } from 'react'
import {
  $getSelection,
  COMMAND_PRIORITY_EDITOR,
  createCommand,
} from 'lexical'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import {
  $createContextBlockNode,
  ContextBlockNode,
} from './node'

export const INSERT_CONTEXT_BLOCK_COMMAND = createCommand()

const ContextBlock = () => {
  const [editor] = useLexicalComposerContext()

  useEffect(() => {
    if (!editor.hasNodes([ContextBlockNode]))
      throw new Error('ContextBlockPlugin: ContextBlock not registered on editor')

    return editor.registerCommand(
      INSERT_CONTEXT_BLOCK_COMMAND,
      () => {
        const contextBlockNode = $createContextBlockNode()
        const selection = $getSelection()

        selection?.insertNodes([contextBlockNode])

        return true
      },
      COMMAND_PRIORITY_EDITOR,
    )
  }, [editor])

  return null
}

export default ContextBlock
