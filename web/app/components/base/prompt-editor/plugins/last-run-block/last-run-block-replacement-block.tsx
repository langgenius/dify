import type { LastRunBlockType } from '../../types'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { mergeRegister } from '@lexical/utils'
import { $applyNodeReplacement } from 'lexical'
import {
  memo,
  useCallback,
  useEffect,
} from 'react'
import { LAST_RUN_PLACEHOLDER_TEXT } from '../../constants'
import { decoratorTransform } from '../../utils'
import { CustomTextNode } from '../custom-text/node'
import {
  $createLastRunBlockNode,
  LastRunBlockNode,
} from './node'

const REGEX = new RegExp(LAST_RUN_PLACEHOLDER_TEXT)

const LastRunReplacementBlock = ({
  onInsert,
}: LastRunBlockType) => {
  const [editor] = useLexicalComposerContext()

  useEffect(() => {
    if (!editor.hasNodes([LastRunBlockNode]))
      throw new Error('LastRunMessageBlockNodePlugin: LastRunMessageBlockNode not registered on editor')
  }, [editor])

  const createLastRunBlockNode = useCallback((): LastRunBlockNode => {
    if (onInsert)
      onInsert()
    return $applyNodeReplacement($createLastRunBlockNode())
  }, [onInsert])

  const getMatch = useCallback((text: string) => {
    const matchArr = REGEX.exec(text)

    if (matchArr === null)
      return null

    const startOffset = matchArr.index
    const endOffset = startOffset + LAST_RUN_PLACEHOLDER_TEXT.length
    return {
      end: endOffset,
      start: startOffset,
    }
  }, [])

  useEffect(() => {
    REGEX.lastIndex = 0
    return mergeRegister(
      editor.registerNodeTransform(CustomTextNode, textNode => decoratorTransform(textNode, getMatch, createLastRunBlockNode)),
    )
  }, [])

  return null
}

export default memo(LastRunReplacementBlock)
