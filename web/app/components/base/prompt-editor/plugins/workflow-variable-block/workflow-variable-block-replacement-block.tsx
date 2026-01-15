import type { TextNode } from 'lexical'
import type { WorkflowVariableBlockType } from '../../types'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { mergeRegister } from '@lexical/utils'
import { $applyNodeReplacement } from 'lexical'
import {
  memo,
  useCallback,
  useEffect,
} from 'react'
import { VAR_REGEX as REGEX, resetReg } from '@/config'
import { decoratorTransform } from '../../utils'
import { CustomTextNode } from '../custom-text/node'
import { WorkflowVariableBlockNode } from './index'
import { $createWorkflowVariableBlockNode } from './node'

const WorkflowVariableBlockReplacementBlock = ({
  workflowNodesMap,
  getVarType,
  onInsert,
  variables,
}: WorkflowVariableBlockType) => {
  const [editor] = useLexicalComposerContext()
  const ragVariables = variables?.reduce<any[]>((acc, curr) => {
    if (curr.nodeId === 'rag')
      acc.push(...curr.vars)
    else
      acc.push(...curr.vars.filter(v => v.isRagVariable))
    return acc
  }, [])

  useEffect(() => {
    if (!editor.hasNodes([WorkflowVariableBlockNode]))
      throw new Error('WorkflowVariableBlockNodePlugin: WorkflowVariableBlockNode not registered on editor')
  }, [editor])

  const createWorkflowVariableBlockNode = useCallback((textNode: TextNode): WorkflowVariableBlockNode => {
    if (onInsert)
      onInsert()

    const nodePathString = textNode.getTextContent().slice(3, -3)
    return $applyNodeReplacement($createWorkflowVariableBlockNode(nodePathString.split('.'), workflowNodesMap, getVarType, variables?.find(o => o.nodeId === 'env')?.vars || [], variables?.find(o => o.nodeId === 'conversation')?.vars || [], ragVariables))
  }, [onInsert, workflowNodesMap, getVarType, variables])

  const getMatch = useCallback((text: string) => {
    const matchArr = REGEX.exec(text)

    if (matchArr === null)
      return null

    const startOffset = matchArr.index
    const endOffset = startOffset + matchArr[0].length
    return {
      end: endOffset,
      start: startOffset,
    }
  }, [])

  const transformListener = useCallback((textNode: CustomTextNode) => {
    resetReg()
    return decoratorTransform(textNode, getMatch, createWorkflowVariableBlockNode)
  }, [createWorkflowVariableBlockNode, getMatch])

  useEffect(() => {
    resetReg()
    return mergeRegister(
      editor.registerNodeTransform(CustomTextNode, transformListener),
    )
  }, [])

  return null
}

export default memo(WorkflowVariableBlockReplacementBlock)
