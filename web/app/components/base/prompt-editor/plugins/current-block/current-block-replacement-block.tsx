import type { CurrentBlockType } from '../../types'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { mergeRegister } from '@lexical/utils'
import { $applyNodeReplacement } from 'lexical'
import {
  memo,
  useCallback,
  useEffect,
} from 'react'
import { CURRENT_PLACEHOLDER_TEXT } from '../../constants'
import { decoratorTransform } from '../../utils'
import { CustomTextNode } from '../custom-text/node'
import {
  $createCurrentBlockNode,
  CurrentBlockNode,
} from './node'

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
