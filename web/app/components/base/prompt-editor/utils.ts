import { $isAtNodeEnd } from '@lexical/selection'
import type {
  ElementNode,
  RangeSelection,
  TextNode,
} from 'lexical'

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
