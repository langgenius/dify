import { useEffect } from 'react'
import {
  $getSelection,
  COMMAND_PRIORITY_EDITOR,
  TextNode,
  createCommand,
} from 'lexical'
import { mergeRegister } from '@lexical/utils'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'

export const INSERT_VARIABLE_BLOCK_COMMAND = createCommand()

const VariableBlock = () => {
  const [editor] = useLexicalComposerContext()

  useEffect(() => {
    return mergeRegister(
      editor.registerCommand(
        INSERT_VARIABLE_BLOCK_COMMAND,
        () => {
          const contextBlockNode = new TextNode('{')
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

export default VariableBlock
