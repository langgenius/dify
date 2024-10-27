import { $isAtNodeEnd } from '@lexical/selection'
import type {
  ElementNode,
  Klass,
  LexicalEditor,
  LexicalNode,
  RangeSelection,
  TextNode,
} from 'lexical'
import {
  $createTextNode,
  $getSelection,
  $isRangeSelection,
  $isTextNode,
} from 'lexical'
import type { EntityMatch } from '@lexical/text'
import { CustomTextNode } from './plugins/custom-text/node'
import type { MenuTextMatch } from './types'

export function getSelectedNode(
  selection: RangeSelection,
): TextNode | ElementNode {
  const anchor = selection.anchor
  const focus = selection.focus
  const anchorNode = selection.anchor.getNode()
  const focusNode = selection.focus.getNode()
  if (anchorNode === focusNode)
    return anchorNode

  const isBackward = selection.isBackward()
  if (isBackward)
    return $isAtNodeEnd(focus) ? anchorNode : focusNode
  else
    return $isAtNodeEnd(anchor) ? anchorNode : focusNode
}

export function registerLexicalTextEntity<T extends TextNode>(
  editor: LexicalEditor,
  getMatch: (text: string) => null | EntityMatch,
  targetNode: Klass<T>,
  createNode: (textNode: TextNode) => T,
) {
  const isTargetNode = (node: LexicalNode | null | undefined): node is T => {
    return node instanceof targetNode
  }

  const replaceWithSimpleText = (node: TextNode): void => {
    const textNode = $createTextNode(node.getTextContent())
    textNode.setFormat(node.getFormat())
    node.replace(textNode)
  }

  const getMode = (node: TextNode): number => {
    return node.getLatest().__mode
  }

  const textNodeTransform = (node: TextNode) => {
    if (!node.isSimpleText())
      return

    const prevSibling = node.getPreviousSibling()
    let text = node.getTextContent()
    let currentNode = node
    let match

    if ($isTextNode(prevSibling)) {
      const previousText = prevSibling.getTextContent()
      const combinedText = previousText + text
      const prevMatch = getMatch(combinedText)

      if (isTargetNode(prevSibling)) {
        if (prevMatch === null || getMode(prevSibling) !== 0) {
          replaceWithSimpleText(prevSibling)
          return
        }
        else {
          const diff = prevMatch.end - previousText.length

          if (diff > 0) {
            const concatText = text.slice(0, diff)
            const newTextContent = previousText + concatText
            prevSibling.select()
            prevSibling.setTextContent(newTextContent)

            if (diff === text.length) {
              node.remove()
            }
            else {
              const remainingText = text.slice(diff)
              node.setTextContent(remainingText)
            }

            return
          }
        }
      }
      else if (prevMatch === null || prevMatch.start < previousText.length) {
        return
      }
    }

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
            if (isTargetNode(nextSibling))
              replaceWithSimpleText(nextSibling)
            else
              nextSibling.markDirty()

            return
          }
          else if (nextMatch.start !== 0) {
            return
          }
        }
      }
      else {
        const nextMatch = getMatch(nextText)

        if (nextMatch !== null && nextMatch.start === 0)
          return
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

      const replacementNode = createNode(nodeToReplace)
      replacementNode.setFormat(nodeToReplace.getFormat())
      nodeToReplace.replace(replacementNode)

      if (currentNode == null)
        return
    }
  }

  const reverseNodeTransform = (node: T) => {
    const text = node.getTextContent()
    const match = getMatch(text)

    if (match === null || match.start !== 0) {
      replaceWithSimpleText(node)
      return
    }

    if (text.length > match.end) {
      // This will split out the rest of the text as simple text
      node.splitText(match.end)
      return
    }

    const prevSibling = node.getPreviousSibling()

    if ($isTextNode(prevSibling) && prevSibling.isTextEntity()) {
      replaceWithSimpleText(prevSibling)
      replaceWithSimpleText(node)
    }

    const nextSibling = node.getNextSibling()

    if ($isTextNode(nextSibling) && nextSibling.isTextEntity()) {
      replaceWithSimpleText(nextSibling) // This may have already been converted in the previous block

      if (isTargetNode(node))
        replaceWithSimpleText(node)
    }
  }

  const removePlainTextTransform = editor.registerNodeTransform(CustomTextNode, textNodeTransform)
  const removeReverseNodeTransform = editor.registerNodeTransform(targetNode, reverseNodeTransform)
  return [removePlainTextTransform, removeReverseNodeTransform]
}

export const decoratorTransform = (
  node: CustomTextNode,
  getMatch: (text: string) => null | EntityMatch,
  createNode: (textNode: TextNode) => LexicalNode,
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
    else {
      const nextMatch = getMatch(nextText)

      if (nextMatch !== null && nextMatch.start === 0)
        return
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

    const replacementNode = createNode(nodeToReplace)
    nodeToReplace.replace(replacementNode)

    if (currentNode == null)
      return
  }
}

function getFullMatchOffset(
  documentText: string,
  entryText: string,
  offset: number,
): number {
  let triggerOffset = offset
  for (let i = triggerOffset; i <= entryText.length; i++) {
    if (documentText.substr(-i) === entryText.substr(0, i))
      triggerOffset = i
  }
  return triggerOffset
}

export function $splitNodeContainingQuery(match: MenuTextMatch): TextNode | null {
  const selection = $getSelection()
  if (!$isRangeSelection(selection) || !selection.isCollapsed())
    return null
  const anchor = selection.anchor
  if (anchor.type !== 'text')
    return null
  const anchorNode = anchor.getNode()
  if (!anchorNode.isSimpleText())
    return null
  const selectionOffset = anchor.offset
  const textContent = anchorNode.getTextContent().slice(0, selectionOffset)
  const characterOffset = match.replaceableString.length
  const queryOffset = getFullMatchOffset(
    textContent,
    match.matchingString,
    characterOffset,
  )
  const startOffset = selectionOffset - queryOffset
  if (startOffset < 0)
    return null
  let newNode
  if (startOffset === 0)
    [newNode] = anchorNode.splitText(selectionOffset)
  else
    [, newNode] = anchorNode.splitText(startOffset, selectionOffset)

  return newNode
}

export function textToEditorState(text: string) {
  const paragraph = text.split('\n')

  return JSON.stringify({
    root: {
      children: paragraph.map((p) => {
        return {
          children: [{
            detail: 0,
            format: 0,
            mode: 'normal',
            style: '',
            text: p,
            type: 'custom-text',
            version: 1,
          }],
          direction: 'ltr',
          format: '',
          indent: 0,
          type: 'paragraph',
          version: 1,
        }
      }),
      direction: 'ltr',
      format: '',
      indent: 0,
      type: 'root',
      version: 1,
    },
  })
}
