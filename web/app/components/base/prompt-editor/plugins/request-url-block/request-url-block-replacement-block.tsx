import type { RequestURLBlockType } from '../../types'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { mergeRegister } from '@lexical/utils'
import { $applyNodeReplacement } from 'lexical'
import {
  memo,
  useCallback,
  useEffect,
} from 'react'
import { REQUEST_URL_PLACEHOLDER_TEXT } from '../../constants'
import { decoratorTransform } from '../../utils'
import { CustomTextNode } from '../custom-text/node'
import {
  $createRequestURLBlockNode,
  RequestURLBlockNode,
} from '../request-url-block/node'

const REGEX = new RegExp(REQUEST_URL_PLACEHOLDER_TEXT)

const RequestURLBlockReplacementBlock = ({
  onInsert,
}: RequestURLBlockType) => {
  const [editor] = useLexicalComposerContext()

  useEffect(() => {
    if (!editor.hasNodes([RequestURLBlockNode]))
      throw new Error('RequestURLBlockNodePlugin: RequestURLBlockNode not registered on editor')
  }, [editor])

  const createRequestURLBlockNode = useCallback((): RequestURLBlockNode => {
    if (onInsert)
      onInsert()
    return $applyNodeReplacement($createRequestURLBlockNode())
  }, [onInsert])

  const getMatch = useCallback((text: string) => {
    const matchArr = REGEX.exec(text)

    if (matchArr === null)
      return null

    const startOffset = matchArr.index
    const endOffset = startOffset + REQUEST_URL_PLACEHOLDER_TEXT.length
    return {
      end: endOffset,
      start: startOffset,
    }
  }, [])

  useEffect(() => {
    REGEX.lastIndex = 0
    return mergeRegister(
      editor.registerNodeTransform(CustomTextNode, textNode => decoratorTransform(textNode, getMatch, createRequestURLBlockNode)),
    )
  }, [])

  return null
}

export default memo(RequestURLBlockReplacementBlock)
