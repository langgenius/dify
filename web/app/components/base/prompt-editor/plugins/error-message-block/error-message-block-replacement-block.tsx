import {
  memo,
  useCallback,
  useEffect,
} from 'react'
import { $applyNodeReplacement } from 'lexical'
import { mergeRegister } from '@lexical/utils'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { decoratorTransform } from '../../utils'
import { ERROR_MESSAGE_PLACEHOLDER_TEXT } from '../../constants'
import type { ErrorMessageBlockType } from '../../types'
import {
  $createErrorMessageBlockNode,
  ErrorMessageBlockNode,
} from './node'
import { CustomTextNode } from '../custom-text/node'

const REGEX = new RegExp(ERROR_MESSAGE_PLACEHOLDER_TEXT)

const ErrorMessageBlockReplacementBlock = ({
  onInsert,
}: ErrorMessageBlockType) => {
  const [editor] = useLexicalComposerContext()

  useEffect(() => {
    if (!editor.hasNodes([ErrorMessageBlockNode]))
      throw new Error('ErrorMessageBlockNodePlugin: ErrorMessageBlockNode not registered on editor')
  }, [editor])

  const createErrorMessageBlockNode = useCallback((): ErrorMessageBlockNode => {
    if (onInsert)
      onInsert()
    return $applyNodeReplacement($createErrorMessageBlockNode())
  }, [onInsert])

  const getMatch = useCallback((text: string) => {
    const matchArr = REGEX.exec(text)

    if (matchArr === null)
      return null

    const startOffset = matchArr.index
    const endOffset = startOffset + ERROR_MESSAGE_PLACEHOLDER_TEXT.length
    return {
      end: endOffset,
      start: startOffset,
    }
  }, [])

  useEffect(() => {
    REGEX.lastIndex = 0
    return mergeRegister(
      editor.registerNodeTransform(CustomTextNode, textNode => decoratorTransform(textNode, getMatch, createErrorMessageBlockNode)),
    )
  }, [])

  return null
}

export default memo(ErrorMessageBlockReplacementBlock)
