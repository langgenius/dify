import { $isAtNodeEnd } from '@lexical/selection'
import type { ElementNode, RangeSelection, TextNode } from 'lexical'

export function getSelectedNode(
  selection: RangeSelection,
): TextNode | ElementNode {
  const anchor = selection.anchor
  const focus = selection.focus
  // console.log(selection, 'selection')
  const anchorNode = selection.anchor.getNode()
  // console.log(anchorNode, 'anchorNode')
  const focusNode = selection.focus.getNode()
  // console.log(focusNode, 'focusNode')
  if (anchorNode === focusNode)
    return anchorNode

  const isBackward = selection.isBackward()
  if (isBackward)
    return $isAtNodeEnd(focus) ? anchorNode : focusNode
  else
    return $isAtNodeEnd(anchor) ? anchorNode : focusNode
}
