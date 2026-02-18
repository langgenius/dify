import type { ContextBlockType } from '../../types'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { mergeRegister } from '@lexical/utils'
import { noop } from 'es-toolkit/function'
import { $applyNodeReplacement } from 'lexical'
import {
  memo,
  useCallback,
  useEffect,
} from 'react'
import { CONTEXT_PLACEHOLDER_TEXT } from '../../constants'
import { decoratorTransform } from '../../utils'
import {
  $createContextBlockNode,
  ContextBlockNode,
} from '../context-block/node'
import { CustomTextNode } from '../custom-text/node'

const REGEX = new RegExp(CONTEXT_PLACEHOLDER_TEXT)

const ContextBlockReplacementBlock = ({
  datasets = [],
  onAddContext = noop,
  onInsert,
  canNotAddContext,
}: ContextBlockType) => {
  const [editor] = useLexicalComposerContext()

  useEffect(() => {
    if (!editor.hasNodes([ContextBlockNode]))
      throw new Error('ContextBlockNodePlugin: ContextBlockNode not registered on editor')
  }, [editor])

  const createContextBlockNode = useCallback((): ContextBlockNode => {
    if (onInsert)
      onInsert()
    return $applyNodeReplacement($createContextBlockNode(datasets, onAddContext, canNotAddContext))
  }, [datasets, onAddContext, onInsert, canNotAddContext])

  const getMatch = useCallback((text: string) => {
    const matchArr = REGEX.exec(text)

    if (matchArr === null)
      return null

    const startOffset = matchArr.index
    const endOffset = startOffset + CONTEXT_PLACEHOLDER_TEXT.length
    return {
      end: endOffset,
      start: startOffset,
    }
  }, [])

  useEffect(() => {
    REGEX.lastIndex = 0
    return mergeRegister(
      editor.registerNodeTransform(CustomTextNode, textNode => decoratorTransform(textNode, getMatch, createContextBlockNode)),
    )
  }, [])

  return null
}

export default memo(ContextBlockReplacementBlock)
