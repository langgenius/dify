import {
  memo,
  useEffect,
} from 'react'
import {
  createCommand,
} from 'lexical'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import type { QueryBlockType } from '../../types'
import {
  HITLInputNode,
} from './node'

export const INSERT_HITL_INPUT_BLOCK_COMMAND = createCommand('INSERT_HITL_INPUT_BLOCK_COMMAND')
export const DELETE_HITL_INPUT_BLOCK_COMMAND = createCommand('DELETE_HITL_INPUT_BLOCK_COMMAND')

export type HITLInputProps = {
  onInsert?: () => void
  onDelete?: () => void
}
const HITLInputBlock = memo(({
  onInsert,
  onDelete,
}: QueryBlockType) => {
  const [editor] = useLexicalComposerContext()

  useEffect(() => {
    if (!editor.hasNodes([HITLInputNode]))
      throw new Error('HITLInputBlockPlugin: HITLInputBlock not registered on editor')
  }, [editor, onInsert, onDelete])

  // TODO
  // const createHITLBlockNode = useCallback

  return null
})

HITLInputBlock.displayName = 'HITLInputBlock'

export { HITLInputBlock }
export { HITLInputNode } from './node'
export { default as HITLInputBlockReplacementBlock } from './hitl-input-block-replacement-block'
