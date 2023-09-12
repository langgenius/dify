import { useEffect } from 'react'
import {
  $getSelection,
  COMMAND_PRIORITY_EDITOR,
  createCommand,
} from 'lexical'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import {
  $createQueryBlockNode,
  QueryBlockNode,
} from './node'

export const INSERT_QUERY_BLOCK_COMMAND = createCommand()

const QueryBlock = () => {
  const [editor] = useLexicalComposerContext()

  useEffect(() => {
    if (!editor.hasNodes([QueryBlockNode]))
      throw new Error('ContextBlockPlugin: ContextBlock not registered on editor')

    return editor.registerCommand(
      INSERT_QUERY_BLOCK_COMMAND,
      () => {
        const contextBlockNode = $createQueryBlockNode()
        const selection = $getSelection()

        selection?.insertNodes([contextBlockNode])

        return true
      },
      COMMAND_PRIORITY_EDITOR,
    )
  }, [editor])

  return null
}

export default QueryBlock
