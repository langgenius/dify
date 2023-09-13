import {
  useCallback,
  useEffect,
} from 'react'
import type { TextNode } from 'lexical'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { useLexicalTextEntity } from '@lexical/react/useLexicalTextEntity'
import {
  $createVariableValueNode,
  VariableValueNode,
} from './node'

const REGEX = /{{([^{{}}].*)?}}/g

const VariableValueBlock = () => {
  const [editor] = useLexicalComposerContext()

  useEffect(() => {
    if (!editor.hasNodes([VariableValueNode]))
      throw new Error('VariableValueBlockPlugin: VariableValueNode not registered on editor')
  }, [editor])

  const createVariableValueNode = useCallback((textNode: TextNode): VariableValueNode => {
    return $createVariableValueNode(textNode.getTextContent().slice(2, -2))
  }, [])

  const getVariableValueMatch = useCallback((text: string) => {
    const matchArr = REGEX.exec(text)

    if (matchArr === null)
      return null

    const variableValueLength = matchArr[0].length
    const startOffset = matchArr.index
    const endOffset = startOffset + variableValueLength
    return {
      end: endOffset,
      start: startOffset,
    }
  }, [])

  useLexicalTextEntity<VariableValueNode>(
    getVariableValueMatch,
    VariableValueNode,
    createVariableValueNode,
  )

  return null
}

export default VariableValueBlock
