import {
  memo,
  useCallback,
  useEffect,
} from 'react'
import { $applyNodeReplacement } from 'lexical'
import { mergeRegister } from '@lexical/utils'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { decoratorTransform } from '../../utils'
import { CURRENT_PLACEHOLDER_TEXT } from '../../constants'
import type { CurrentBlockType } from '../../types'
import {
  $createCurrentBlockNode,
  CurrentBlockNode,
} from './node'
import { CustomTextNode } from '../custom-text/node'

const REGEX = new RegExp(CURRENT_PLACEHOLDER_TEXT)

const CurrentBlockReplacementBlock = ({
  generatorType,
  onInsert,
}: CurrentBlockType) => {
  const [editor] = useLexicalComposerContext()

  useEffect(() => {
    if (!editor.hasNodes([CurrentBlockNode]))
      throw new Error('CurrentBlockNodePlugin: CurrentBlockNode not registered on editor')
  }, [editor])

  const createCurrentBlockNode = useCallback((): CurrentBlockNode => {
    if (onInsert)
      onInsert()
    return $applyNodeReplacement($createCurrentBlockNode(generatorType))
  }, [onInsert, generatorType])

  const getMatch = useCallback((text: string) => {
    const matchArr = REGEX.exec(text)

    if (matchArr === null)
      return null

    const startOffset = matchArr.index
    const endOffset = startOffset + CURRENT_PLACEHOLDER_TEXT.length
    return {
      end: endOffset,
      start: startOffset,
    }
  }, [])

  useEffect(() => {
    REGEX.lastIndex = 0
    return mergeRegister(
      editor.registerNodeTransform(CustomTextNode, textNode => decoratorTransform(textNode, getMatch, createCurrentBlockNode)),
    )
  }, [])

  return null
}

export default memo(CurrentBlockReplacementBlock)
