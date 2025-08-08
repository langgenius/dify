import {
  memo,
  useCallback,
  useEffect,
} from 'react'
import type { TextNode } from 'lexical'
import { $applyNodeReplacement } from 'lexical'
import { mergeRegister } from '@lexical/utils'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { decoratorTransform } from '../../utils'
import type { HITLInputBlockType } from '../../types'
import { $createHITLInputNode } from './node'
import {
  QueryBlockNode,
} from '../query-block/node'
import { CustomTextNode } from '../custom-text/node'
import { HITL_INPUT_REG } from '@/config'

const REGEX = new RegExp(HITL_INPUT_REG)

const HITLInputReplacementBlock = ({
  // onInsert,
  nodeTitle,
  formInputs,
  onFormInputsChange,
  onFormInputItemRemove,
}: HITLInputBlockType) => {
  const [editor] = useLexicalComposerContext()

  useEffect(() => {
    if (!editor.hasNodes([QueryBlockNode]))
      throw new Error('QueryBlockNodePlugin: QueryBlockNode not registered on editor')
  }, [editor])

  const createHITLInputBlockNode = useCallback((textNode: TextNode): QueryBlockNode => {
    const varName = textNode.getTextContent().split('.')[1].replace(/#}}$/, '')
    return $applyNodeReplacement($createHITLInputNode(
      varName,
      nodeTitle,
      formInputs || [],
      onFormInputsChange!,
      onFormInputItemRemove!,
    ))
  }, [nodeTitle, formInputs, onFormInputsChange, onFormInputItemRemove])

  const getMatch = useCallback((text: string) => {
    const matchArr = REGEX.exec(text)

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
    REGEX.lastIndex = 0
    return mergeRegister(
      editor.registerNodeTransform(CustomTextNode, textNode => decoratorTransform(textNode, getMatch, createHITLInputBlockNode)),
    )
  }, [])

  return null
}

export default memo(HITLInputReplacementBlock)
