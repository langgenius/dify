import {
  useCallback,
  useEffect,
} from 'react'
import { $applyNodeReplacement } from 'lexical'
import { mergeRegister } from '@lexical/utils'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { decoratorTransform } from '../../utils'
import { HISTORY_PLACEHOLDER_TEXT } from '../../constants'
import type { HistoryBlockType } from '../../types'
import {
  $createHistoryBlockNode,
  HistoryBlockNode,
} from '../history-block/node'
import { CustomTextNode } from '../custom-text/node'
import { noop } from 'lodash-es'

const REGEX = new RegExp(HISTORY_PLACEHOLDER_TEXT)

const HistoryBlockReplacementBlock = ({
  history = { user: '', assistant: '' },
  onEditRole = noop,
  onInsert,
}: HistoryBlockType) => {
  const [editor] = useLexicalComposerContext()

  useEffect(() => {
    if (!editor.hasNodes([HistoryBlockNode]))
      throw new Error('HistoryBlockNodePlugin: HistoryBlockNode not registered on editor')
  }, [editor])

  const createHistoryBlockNode = useCallback((): HistoryBlockNode => {
    if (onInsert)
      onInsert()
    return $applyNodeReplacement($createHistoryBlockNode(history, onEditRole))
  }, [history, onEditRole, onInsert])

  const getMatch = useCallback((text: string) => {
    const matchArr = REGEX.exec(text)

    if (matchArr === null)
      return null

    const startOffset = matchArr.index
    const endOffset = startOffset + HISTORY_PLACEHOLDER_TEXT.length
    return {
      end: endOffset,
      start: startOffset,
    }
  }, [])

  useEffect(() => {
    REGEX.lastIndex = 0
    return mergeRegister(
      editor.registerNodeTransform(CustomTextNode, textNode => decoratorTransform(textNode, getMatch, createHistoryBlockNode)),
    )
  }, [])

  return null
}

export default HistoryBlockReplacementBlock
