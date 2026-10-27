import type { TextNode } from 'lexical'
import type { WorkflowVariableBlockType } from '../../types'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { $applyNodeReplacement } from 'lexical'
import { memo, useCallback, useEffect, useEffectEvent } from 'react'
import { VAR_REGEX as REGEX, resetReg } from '@/config'
import { decoratorTransform } from '../../utils'
import { CustomTextNode } from '../custom-text/node'
import { WorkflowVariableBlockNode } from './index'
import { $createWorkflowVariableBlockNode } from './node'

const WorkflowVariableBlockReplacementBlock = ({
  workflowNodesMap = {},
  getVarType,
  onInsert,
  variables,
}: WorkflowVariableBlockType) => {
  const [editor] = useLexicalComposerContext()

  useEffect(() => {
    if (!editor.hasNodes([WorkflowVariableBlockNode]))
      throw new Error(
        'WorkflowVariableBlockNodePlugin: WorkflowVariableBlockNode not registered on editor',
      )
  }, [editor])

  const createWorkflowVariableBlockNode = useCallback(
    (textNode: TextNode): WorkflowVariableBlockNode => {
      if (onInsert) onInsert()

      const nodePathString = textNode.getTextContent().slice(3, -3)
      return $applyNodeReplacement(
        $createWorkflowVariableBlockNode(
          nodePathString.split('.'),
          workflowNodesMap,
          getVarType,
          variables || [],
        ),
      )
    },
    [onInsert, workflowNodesMap, getVarType, variables],
  )

  const getMatch = useCallback((text: string) => {
    const matchArr = REGEX.exec(text)

    if (matchArr === null) return null

    const startOffset = matchArr.index
    const endOffset = startOffset + matchArr[0].length
    return {
      end: endOffset,
      start: startOffset,
    }
  }, [])

  const transformText = useEffectEvent((textNode: CustomTextNode) => {
    resetReg()
    return decoratorTransform(textNode, getMatch, createWorkflowVariableBlockNode)
  })

  useEffect(() => {
    resetReg()
    // Re-registering dirties existing text and restores the old selection. Keep
    // the registration stable while using the latest variable metadata.
    return editor.registerNodeTransform(CustomTextNode, (textNode) => transformText(textNode))
  }, [editor])

  return null
}

export default memo(WorkflowVariableBlockReplacementBlock)
