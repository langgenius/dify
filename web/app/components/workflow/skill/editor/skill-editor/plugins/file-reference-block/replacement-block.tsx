import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { mergeRegister } from '@lexical/utils'
import { $createTextNode } from 'lexical'
import { useEffect, useMemo } from 'react'
import { CustomTextNode } from '@/app/components/base/prompt-editor/plugins/custom-text/node'
import { decoratorTransform } from '@/app/components/base/prompt-editor/utils'
import { $createFileReferenceNode, FileReferenceNode } from './node'
import { getFileReferenceTokenRegexString, parseFileReferenceToken } from './utils'

const FileReferenceReplacementBlock = () => {
  const [editor] = useLexicalComposerContext()
  const regex = useMemo(() => new RegExp(getFileReferenceTokenRegexString(), 'i'), [])

  useEffect(() => {
    if (!editor.hasNodes([FileReferenceNode]))
      throw new Error('FileReferenceReplacementBlock: FileReferenceNode not registered on editor')

    const getMatch = (text: string) => {
      const matchArr = regex.exec(text)
      if (!matchArr)
        return null
      return {
        start: matchArr.index,
        end: matchArr.index + matchArr[0].length,
      }
    }

    const createFileReferenceNode = (textNode: CustomTextNode) => {
      const parsed = parseFileReferenceToken(textNode.getTextContent())
      if (!parsed)
        return $createTextNode(textNode.getTextContent())
      return $createFileReferenceNode(parsed)
    }

    return mergeRegister(
      editor.registerNodeTransform(CustomTextNode, textNode => decoratorTransform(textNode, getMatch, createFileReferenceNode)),
    )
  }, [editor, regex])

  return null
}

export default FileReferenceReplacementBlock
