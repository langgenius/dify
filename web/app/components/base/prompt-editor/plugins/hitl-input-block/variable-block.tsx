import type { WorkflowNodesMap } from '../workflow-variable-block/node'
import type { ValueSelector, Var } from '@/app/components/workflow/types'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { mergeRegister } from '@lexical/utils'
import {
  COMMAND_PRIORITY_EDITOR,
} from 'lexical'
import {
  memo,
  useEffect,
  useMemo,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import Tooltip from '@/app/components/base/tooltip'
import {
  isConversationVar,
  isENV,
  isGlobalVar,
  isRagVariableVar,
  isSystemVar,
} from '@/app/components/workflow/nodes/_base/components/variable/utils'
import VarFullPathPanel from '@/app/components/workflow/nodes/_base/components/variable/var-full-path-panel'
import {
  VariableLabelInEditor,
} from '@/app/components/workflow/nodes/_base/components/variable/variable-label'
import { Type } from '@/app/components/workflow/nodes/llm/types'
import { isExceptionVariable } from '@/app/components/workflow/utils'
import { UPDATE_WORKFLOW_NODES_MAP } from '../workflow-variable-block'
import { HITLInputNode } from './node'

type HITLInputVariableBlockComponentProps = {
  variables: string[]
  workflowNodesMap: WorkflowNodesMap
  environmentVariables?: Var[]
  conversationVariables?: Var[]
  ragVariables?: Var[]
  getVarType?: (payload: {
    nodeId: string
    valueSelector: ValueSelector
  }) => Type
}

const HITLInputVariableBlockComponent = ({
  variables,
  workflowNodesMap = {},
  getVarType,
  environmentVariables,
  conversationVariables,
  ragVariables,
}: HITLInputVariableBlockComponentProps) => {
  const { t } = useTranslation()
  const [editor] = useLexicalComposerContext()
  const variablesLength = variables.length
  const isRagVar = isRagVariableVar(variables)
  const isShowAPart = variablesLength > 2 && !isRagVar
  const varName = (
    () => {
      const isSystem = isSystemVar(variables)
      const varName = variables[variablesLength - 1]
      return `${isSystem ? 'sys.' : ''}${varName}`
    }
  )()
  const [localWorkflowNodesMap, setLocalWorkflowNodesMap] = useState<WorkflowNodesMap>(workflowNodesMap)
  const node = localWorkflowNodesMap![variables[isRagVar ? 1 : 0]]

  const isException = isExceptionVariable(varName, node?.type)
  const variableValid = useMemo(() => {
    let variableValid = true
    const isEnv = isENV(variables)
    const isChatVar = isConversationVar(variables)
    const isGlobal = isGlobalVar(variables)
    if (isGlobal)
      return true

    if (isEnv) {
      if (environmentVariables)
        variableValid = environmentVariables.some(v => v.variable === `${variables?.[0] ?? ''}.${variables?.[1] ?? ''}`)
    }
    else if (isChatVar) {
      if (conversationVariables)
        variableValid = conversationVariables.some(v => v.variable === `${variables?.[0] ?? ''}.${variables?.[1] ?? ''}`)
    }
    else if (isRagVar) {
      if (ragVariables)
        variableValid = ragVariables.some(v => v.variable === `${variables?.[0] ?? ''}.${variables?.[1] ?? ''}.${variables?.[2] ?? ''}`)
    }
    else {
      variableValid = !!node
    }
    return variableValid
  }, [variables, node, environmentVariables, conversationVariables, isRagVar, ragVariables])

  useEffect(() => {
    if (!editor.hasNodes([HITLInputNode]))
      throw new Error('HITLInputNodePlugin: HITLInputNode not registered on editor')

    return mergeRegister(
      editor.registerCommand(
        UPDATE_WORKFLOW_NODES_MAP,
        (workflowNodesMap: WorkflowNodesMap) => {
          setLocalWorkflowNodesMap(workflowNodesMap)

          return true
        },
        COMMAND_PRIORITY_EDITOR,
      ),
    )
  }, [editor])

  const Item = (
    <VariableLabelInEditor
      nodeType={node?.type}
      nodeTitle={node?.title}
      variables={variables}
      isExceptionVariable={isException}
      errorMsg={!variableValid ? t('errorMsg.invalidVariable', { ns: 'workflow' }) : undefined}
      notShowFullPath={isShowAPart}
    />
  )

  if (!node)
    return Item

  return (
    <Tooltip
      noDecoration
      popupContent={(
        <VarFullPathPanel
          nodeName={node.title}
          path={variables.slice(1)}
          varType={getVarType
            ? getVarType({
                nodeId: variables[0],
                valueSelector: variables,
              })
            : Type.string}
          nodeType={node?.type}
        />
      )}
      disabled={!isShowAPart}
    >
      <div>{Item}</div>
    </Tooltip>
  )
}

export default memo(HITLInputVariableBlockComponent)
