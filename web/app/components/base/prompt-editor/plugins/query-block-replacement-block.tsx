import type { FC } from 'react'
import {
  useCallback,
  useEffect,
} from 'react'
import { $applyNodeReplacement } from 'lexical'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { useLexicalTextEntity } from '../hooks'
import { QUERY_PLACEHOLDER_TEXT } from '../constants'
import {
  $createQueryBlockNode,
  QueryBlockNode,
} from './query-block/node'
import type { QueryBlockProps } from './query-block/index'

const REGEX = new RegExp(QUERY_PLACEHOLDER_TEXT)

const QueryBlockReplacementBlock: FC<QueryBlockProps> = ({
  onInsert,
}) => {
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

  const getVariableValueMatch = useCallback((text: string) => {
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

  useLexicalTextEntity<any>(
    getVariableValueMatch,
    QueryBlockNode,
    createQueryBlockNode,
  )

  return null
}

export default QueryBlockReplacementBlock
