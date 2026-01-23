import type { ToolBlockPayload } from './node'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { mergeRegister } from '@lexical/utils'
import {
  $insertNodes,
  COMMAND_PRIORITY_EDITOR,
  createCommand,
} from 'lexical'
import { memo, useEffect } from 'react'
import { $createToolBlockNode, ToolBlockNode } from './node'

export const INSERT_TOOL_BLOCK_COMMAND = createCommand<ToolBlockPayload>('INSERT_TOOL_BLOCK_COMMAND')
export const DELETE_TOOL_BLOCK_COMMAND = createCommand('DELETE_TOOL_BLOCK_COMMAND')

const ToolBlock = memo(() => {
  const [editor] = useLexicalComposerContext()

  useEffect(() => {
    if (!editor.hasNodes([ToolBlockNode]))
      throw new Error('ToolBlockPlugin: ToolBlockNode not registered on editor')

    return mergeRegister(
      editor.registerCommand(
        INSERT_TOOL_BLOCK_COMMAND,
        (payload: ToolBlockPayload) => {
          const toolBlockNode = $createToolBlockNode(payload)
          $insertNodes([toolBlockNode])
          return true
        },
        COMMAND_PRIORITY_EDITOR,
      ),
      editor.registerCommand(
        DELETE_TOOL_BLOCK_COMMAND,
        () => true,
        COMMAND_PRIORITY_EDITOR,
      ),
    )
  }, [editor])

  return null
})
ToolBlock.displayName = 'ToolBlock'

export { ToolBlock }
export { ToolBlockNode } from './node'
export { default as ToolBlockReplacementBlock } from './tool-block-replacement-block'
export { ToolGroupBlockNode } from './tool-group-block-node'
export { default as ToolGroupBlockReplacementBlock } from './tool-group-block-replacement-block'
