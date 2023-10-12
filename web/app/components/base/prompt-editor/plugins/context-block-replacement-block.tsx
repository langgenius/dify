import type { FC } from 'react'
import {
  useCallback,
  useEffect,
} from 'react'
import { $applyNodeReplacement } from 'lexical'
import { mergeRegister } from '@lexical/utils'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { decoratorTransform } from '../utils'
import { CONTEXT_PLACEHOLDER_TEXT } from '../constants'
import {
  $createContextBlockNode,
  ContextBlockNode,
} from './context-block/node'
import type { ContextBlockProps } from './context-block/index'
import { CustomTextNode } from './custom-text/node'

const REGEX = new RegExp(CONTEXT_PLACEHOLDER_TEXT)

const ContextBlockReplacementBlock: FC<ContextBlockProps> = ({
  datasets,
  onAddContext,
  onInsert,
}) => {
  const [editor] = useLexicalComposerContext()

  useEffect(() => {
    if (!editor.hasNodes([ContextBlockNode]))
      throw new Error('ContextBlockNodePlugin: ContextBlockNode not registered on editor')
  }, [editor])

  const createContextBlockNode = useCallback((): ContextBlockNode => {
    if (onInsert)
      onInsert()
    return $applyNodeReplacement($createContextBlockNode(datasets, onAddContext))
  }, [datasets, onAddContext, onInsert])

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
    return mergeRegister(
      editor.registerNodeTransform(CustomTextNode, textNode => decoratorTransform(textNode, getMatch, createContextBlockNode)),
    )
  }, [])

  return null
}

export default ContextBlockReplacementBlock
