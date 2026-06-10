import type { QueryBlockType } from '../../types'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { mergeRegister } from '@lexical/utils'
import { $applyNodeReplacement } from 'lexical'
import {
  memo,
  useCallback,
  useEffect,
} from 'react'
import { QUERY_PLACEHOLDER_TEXT } from '../../constants'
import { decoratorTransform } from '../../utils'
import { CustomTextNode } from '../custom-text/node'
import {
  $createQueryBlockNode,
  QueryBlockNode,
} from '../query-block/node'

const REGEX = new RegExp(QUERY_PLACEHOLDER_TEXT)

const QueryBlockReplacementBlock = ({
  onInsert,
}: QueryBlockType) => {
  const [editor] = useLexicalComposerContext()

  useEffect(() => {
    if (!editor.hasNodes([QueryBlockNode]))
      throw new Error('QueryBlockNodePlugin: QueryBlockNode not registered on editor')
  }, [editor])

  const createQueryBlockNode = useCallback((): QueryBlockNode => {
    if (onInsert)
      onInsert()
    return $applyNodeReplacement($createQueryBlockNode())
  }, [onInsert])

  const getMatch = useCallback((text: string) => {
    const matchArr = REGEX.exec(text)

    if (matchArr === null)
      return null

    const startOffset = matchArr.index
    const endOffset = startOffset + QUERY_PLACEHOLDER_TEXT.length
    return {
      end: endOffset,
      start: startOffset,
    }
  }, [])

  useEffect(() => {
    REGEX.lastIndex = 0
    return mergeRegister(
      editor.registerNodeTransform(CustomTextNode, textNode => decoratorTransform(textNode, getMatch, createQueryBlockNode)),
    )
  }, [])

  return null
}

export default memo(QueryBlockReplacementBlock)
