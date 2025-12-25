import {
  memo,
  useCallback,
  useEffect,
  useMemo,
} from 'react'
import type { TextNode } from 'lexical'
import { $applyNodeReplacement } from 'lexical'
import { mergeRegister } from '@lexical/utils'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { decoratorTransform } from '../../utils'
import type { HITLInputBlockType } from '../../types'
import { $createHITLInputNode, HITLInputNode } from './node'
import { CustomTextNode } from '../custom-text/node'
import { HITL_INPUT_REG } from '@/config'

const REGEX = new RegExp(HITL_INPUT_REG)

const HITLInputReplacementBlock = ({
  nodeId,
  formInputs,
  onFormInputsChange,
  onFormInputItemRename,
  onFormInputItemRemove,
  workflowNodesMap,
  getVarType,
  variables,
}: HITLInputBlockType) => {
  const [editor] = useLexicalComposerContext()

  const environmentVariables = useMemo(() => variables?.find(o => o.nodeId === 'env')?.vars || [], [variables])
  const conversationVariables = useMemo(() => variables?.find(o => o.nodeId === 'conversation')?.vars || [], [variables])
  const ragVariables = useMemo(() => variables?.reduce<any[]>((acc, curr) => {
    if (curr.nodeId === 'rag')
      acc.push(...curr.vars)
    else
      acc.push(...curr.vars.filter(v => v.isRagVariable))
    return acc
  }, []), [variables])

  useEffect(() => {
    if (!editor.hasNodes([HITLInputNode]))
      throw new Error('HITLInputNodePlugin: HITLInputNode not registered on editor')
  }, [editor])

  const createHITLInputBlockNode = useCallback((textNode: TextNode): HITLInputNode => {
    const varName = textNode.getTextContent().split('.')[1].replace(/#}}$/, '')
    return $applyNodeReplacement($createHITLInputNode(
      varName,
      nodeId,
      formInputs || [],
      onFormInputsChange!,
      onFormInputItemRename,
      onFormInputItemRemove!,
      workflowNodesMap,
      getVarType,
      environmentVariables,
      conversationVariables,
      ragVariables,
    ))
  }, [nodeId, formInputs, onFormInputsChange, onFormInputItemRename, onFormInputItemRemove, workflowNodesMap, getVarType, environmentVariables, conversationVariables, ragVariables])

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

  useEffect(() => {
    REGEX.lastIndex = 0
    return mergeRegister(
      editor.registerNodeTransform(CustomTextNode, textNode => decoratorTransform(textNode, getMatch, createHITLInputBlockNode)),
    )
  }, [])

  return null
}

export default memo(HITLInputReplacementBlock)
