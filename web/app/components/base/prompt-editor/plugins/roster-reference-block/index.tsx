import type { EntityMatch } from '@lexical/text'
import type { LexicalEditor, TextNode } from 'lexical'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { mergeRegister } from '@lexical/utils'
import { $applyNodeReplacement } from 'lexical'
import {
  useCallback,
  useEffect,
} from 'react'
import { decoratorTransform } from '../../utils'
import { CustomTextNode } from '../custom-text/node'
import { RosterReferenceBlockNode } from './node'
import { ROSTER_REFERENCE_REGEX } from './utils'

type RosterReferenceNodeRegistry = {
  _nodes: Map<string, { klass: typeof RosterReferenceBlockNode }>
}

function createRegisteredRosterReferenceBlockNode(editor: LexicalEditor, textNode: TextNode): RosterReferenceBlockNode {
  const RegisteredRosterReferenceBlockNode = (editor as unknown as RosterReferenceNodeRegistry)
    ._nodes
    .get(RosterReferenceBlockNode.getType())
    ?.klass ?? RosterReferenceBlockNode

  return $applyNodeReplacement(new RegisteredRosterReferenceBlockNode(textNode.getTextContent()))
}

const RosterReferenceBlock = () => {
  const [editor] = useLexicalComposerContext()

  useEffect(() => {
    if (!editor.hasNodes([RosterReferenceBlockNode]))
      throw new Error('RosterReferenceBlockPlugin: RosterReferenceBlockNode not registered on editor')
  }, [editor])

  const createRosterReferenceBlockNode = useCallback((textNode: CustomTextNode): RosterReferenceBlockNode => (
    createRegisteredRosterReferenceBlockNode(editor, textNode)
  ), [editor])

  const getRosterReferenceMatch = useCallback((text: string): EntityMatch | null => {
    const matchArr = ROSTER_REFERENCE_REGEX.exec(text)

    if (matchArr === null)
      return null

    const startOffset = matchArr.index
    const endOffset = startOffset + matchArr[0].length
    return {
      end: endOffset,
      start: startOffset,
    }
  }, [])

  useEffect(() => {
    return mergeRegister(
      editor.registerNodeTransform(CustomTextNode, textNode => decoratorTransform(textNode, getRosterReferenceMatch, createRosterReferenceBlockNode)),
    )
  }, [createRosterReferenceBlockNode, editor, getRosterReferenceMatch])

  return null
}

export default RosterReferenceBlock
