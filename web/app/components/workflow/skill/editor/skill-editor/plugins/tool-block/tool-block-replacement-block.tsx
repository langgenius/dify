import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { mergeRegister } from '@lexical/utils'
import { $createTextNode } from 'lexical'
import { useEffect, useMemo } from 'react'
import { CustomTextNode } from '@/app/components/base/prompt-editor/plugins/custom-text/node'
import { decoratorTransform } from '@/app/components/base/prompt-editor/utils'
import { $createToolBlockNode, ToolBlockNode } from './node'
import { getToolTokenRegexString, parseToolToken } from './utils'

const ToolBlockReplacementBlock = () => {
  const [editor] = useLexicalComposerContext()
  const regex = useMemo(() => new RegExp(getToolTokenRegexString(), 'i'), [])

  useEffect(() => {
    if (!editor.hasNodes([ToolBlockNode]))
      throw new Error('ToolBlockReplacementBlock: ToolBlockNode not registered on editor')

    const getMatch = (text: string) => {
      const matchArr = regex.exec(text)
      if (!matchArr)
        return null
      return {
        start: matchArr.index,
        end: matchArr.index + matchArr[0].length,
      }
    }

    const createToolBlockNode = (textNode: CustomTextNode) => {
      const parsed = parseToolToken(textNode.getTextContent())
      if (!parsed)
        return $createTextNode(textNode.getTextContent())
      return $createToolBlockNode(parsed)
    }

    return mergeRegister(
      editor.registerNodeTransform(CustomTextNode, textNode => decoratorTransform(textNode, getMatch, createToolBlockNode)),
    )
  }, [editor, regex])

  return null
}

export default ToolBlockReplacementBlock
