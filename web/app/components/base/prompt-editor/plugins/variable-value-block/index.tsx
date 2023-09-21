import {
  useCallback,
  useEffect,
  useState,
} from 'react'
import type { TextNode } from 'lexical'
import {
  $getSelection,
  $isRangeSelection,
  COMMAND_PRIORITY_EDITOR,
  SELECTION_CHANGE_COMMAND,
} from 'lexical'
import { mergeRegister } from '@lexical/utils'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { useLexicalTextEntity } from '../../hooks'
import { getSelectedNode } from '../../utils'
import {
  $createVariableValueBlockNode,
  $isVariableValueNodeBlock,
  VariableValueBlockNode,
} from './node'
import { getHashtagRegexString } from './utils'

const REGEX = new RegExp(getHashtagRegexString(), 'i')

const VariableValueBlock = () => {
  const [editor] = useLexicalComposerContext()
  const [focusing, setFocusing] = useState(false)

  useEffect(() => {
    if (!editor.hasNodes([VariableValueBlockNode]))
      throw new Error('VariableValueBlockPlugin: VariableValueNode not registered on editor')
  }, [editor])

  const createVariableValueBlockNode = useCallback((textNode: TextNode): VariableValueBlockNode => {
    return $createVariableValueBlockNode(textNode.getTextContent())
  }, [])

  const getVariableValueMatch = useCallback((text: string) => {
    const matchArr = REGEX.exec(text)

    if (matchArr === null)
      return null

    const hashtagLength = matchArr[3].length + 4
    const startOffset = matchArr.index
    const endOffset = startOffset + hashtagLength
    return {
      end: endOffset,
      start: startOffset,
    }
  }, [])

  useEffect(() => {
    return mergeRegister(
      editor.registerCommand(
        SELECTION_CHANGE_COMMAND,
        () => {
          const selection = $getSelection()

          if ($isRangeSelection(selection)) {
            const node = getSelectedNode(selection)

            if ($isVariableValueNodeBlock(node))
              setFocusing(true)
            else
              setFocusing(false)
          }
          return false
        },
        COMMAND_PRIORITY_EDITOR,
      ),
    )
  }, [editor])

  useLexicalTextEntity<VariableValueBlockNode>(
    getVariableValueMatch,
    VariableValueBlockNode,
    createVariableValueBlockNode,
  )

  return null
}

export default VariableValueBlock
