import type { EntityMatch } from '@lexical/text'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { mergeRegister } from '@lexical/utils'
import {
  useCallback,
  useEffect,
} from 'react'
import { decoratorTransform } from '../../utils'
import { CustomTextNode } from '../custom-text/node'
import {
  $createRosterReferenceBlockNode,
  RosterReferenceBlockNode,
} from './node'
import { ROSTER_REFERENCE_REGEX } from './utils'

const RosterReferenceBlock = () => {
  const [editor] = useLexicalComposerContext()

  useEffect(() => {
    if (!editor.hasNodes([RosterReferenceBlockNode]))
      throw new Error('RosterReferenceBlockPlugin: RosterReferenceBlockNode not registered on editor')
  }, [editor])

  const createRosterReferenceBlockNode = useCallback((textNode: CustomTextNode): RosterReferenceBlockNode => {
    return $createRosterReferenceBlockNode(textNode.getTextContent())
  }, [])

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
