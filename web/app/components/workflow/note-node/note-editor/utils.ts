import { $isAtNodeEnd } from '@lexical/selection'
import type { ElementNode, RangeSelection, TextNode } from 'lexical'

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

export const urlRegExp = /((([A-Za-z]{3,9}:(?:\/\/)?)(?:[-;:&=+$,\w]+@)?[A-Za-z0-9.-]+|(?:www.|[-;:&=+$,\w]+@)[A-Za-z0-9.-]+)((?:\/[+~%/.\w-_]*)?\??(?:[-+=&;%@.\w_]*)#?(?:[\w]*))?)/
