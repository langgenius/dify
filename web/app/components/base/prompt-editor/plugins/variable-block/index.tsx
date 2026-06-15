import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { mergeRegister } from '@lexical/utils'
import {
  $insertNodes,
  COMMAND_PRIORITY_EDITOR,
  createCommand,
} from 'lexical'
import { useEffect } from 'react'
import { CustomTextNode } from '../custom-text/node'

export const INSERT_VARIABLE_BLOCK_COMMAND = createCommand('INSERT_VARIABLE_BLOCK_COMMAND')
export const INSERT_VARIABLE_VALUE_BLOCK_COMMAND = createCommand('INSERT_VARIABLE_VALUE_BLOCK_COMMAND')

const VariableBlock = () => {
  const [editor] = useLexicalComposerContext()

  useEffect(() => {
    return mergeRegister(
      editor.registerCommand(
        INSERT_VARIABLE_BLOCK_COMMAND,
        () => {
          const textNode = new CustomTextNode('{')
          $insertNodes([textNode])

          return true
        },
        COMMAND_PRIORITY_EDITOR,
      ),
      editor.registerCommand(
        INSERT_VARIABLE_VALUE_BLOCK_COMMAND,
        (value: string) => {
          const textNode = new CustomTextNode(value)
          $insertNodes([textNode])

          return true
        },
        COMMAND_PRIORITY_EDITOR,
      ),
    )
  }, [editor])

  return null
}

export default VariableBlock
