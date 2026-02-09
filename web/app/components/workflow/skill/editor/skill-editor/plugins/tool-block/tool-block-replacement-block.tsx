import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { mergeRegister } from '@lexical/utils'
import { $createTextNode, $isTextNode } from 'lexical'
import { useEffect, useMemo } from 'react'
import { CustomTextNode } from '@/app/components/base/prompt-editor/plugins/custom-text/node'
import { $createToolBlockNode, ToolBlockNode } from './node'
import { getToolTokenRegexString, parseToolToken } from './utils'

const decoratorTransformAllowAdjacent = (
  node: CustomTextNode,
  getMatch: (text: string) => null | { start: number, end: number },
  createNode: (textNode: CustomTextNode) => ReturnType<typeof $createTextNode> | ToolBlockNode,
) => {
  if (!node.isSimpleText())
    return

  const prevSibling = node.getPreviousSibling()
  let text = node.getTextContent()
  let currentNode = node
  let match

  while (true) {
    match = getMatch(text)
    let nextText = match === null ? '' : text.slice(match.end)
    text = nextText

    if (nextText === '') {
      const nextSibling = currentNode.getNextSibling()

      if ($isTextNode(nextSibling)) {
        nextText = currentNode.getTextContent() + nextSibling.getTextContent()
        const nextMatch = getMatch(nextText)

        if (nextMatch === null) {
          nextSibling.markDirty()
          return
        }
        else if (nextMatch.start !== 0) {
          return
        }
      }
    }

    if (match === null)
      return

    if (match.start === 0 && $isTextNode(prevSibling) && prevSibling.isTextEntity())
      continue

    let nodeToReplace

    if (match.start === 0)
      [nodeToReplace, currentNode] = currentNode.splitText(match.end)
    else
      [, nodeToReplace, currentNode] = currentNode.splitText(match.start, match.end)

    const replacementNode = createNode(nodeToReplace as CustomTextNode)
    nodeToReplace.replace(replacementNode)

    if (currentNode == null)
      return
  }
}

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
      editor.registerNodeTransform(CustomTextNode, textNode => decoratorTransformAllowAdjacent(textNode, getMatch, createToolBlockNode)),
    )
  }, [editor, regex])

  return null
}

export default ToolBlockReplacementBlock
