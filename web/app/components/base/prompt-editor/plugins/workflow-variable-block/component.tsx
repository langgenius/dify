import type { WorkflowNodesMap } from './node'
import type { ValueSelector, Var } from '@/app/components/workflow/types'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { mergeRegister } from '@lexical/utils'
import {
  COMMAND_PRIORITY_EDITOR,
} from 'lexical'
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import { useReactFlow, useStoreApi } from 'reactflow'
import Tooltip from '@/app/components/base/tooltip'
import { isConversationVar, isENV, isGlobalVar, isRagVariableVar, isSystemVar } from '@/app/components/workflow/nodes/_base/components/variable/utils'
import VarFullPathPanel from '@/app/components/workflow/nodes/_base/components/variable/var-full-path-panel'
import {
  VariableLabelInEditor,
} from '@/app/components/workflow/nodes/_base/components/variable/variable-label'
import { Type } from '@/app/components/workflow/nodes/llm/types'
import { isExceptionVariable } from '@/app/components/workflow/utils'
import { useSelectOrDelete } from '../../hooks'
import {
  DELETE_WORKFLOW_VARIABLE_BLOCK_COMMAND,
  UPDATE_WORKFLOW_NODES_MAP,
} from './index'
import { WorkflowVariableBlockNode } from './node'

type WorkflowVariableBlockComponentProps = {
  nodeKey: string
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

const WorkflowVariableBlockComponent = ({
  nodeKey,
  variables,
  workflowNodesMap = {},
  getVarType,
  environmentVariables,
  conversationVariables,
  ragVariables,
}: WorkflowVariableBlockComponentProps) => {
  const { t } = useTranslation()
  const [editor] = useLexicalComposerContext()
  const [ref, isSelected] = useSelectOrDelete(nodeKey, DELETE_WORKFLOW_VARIABLE_BLOCK_COMMAND)
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

  const reactflow = useReactFlow()
  const store = useStoreApi()

  useEffect(() => {
    if (!editor.hasNodes([WorkflowVariableBlockNode]))
      throw new Error('WorkflowVariableBlockPlugin: WorkflowVariableBlock not registered on editor')

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

  const handleVariableJump = useCallback(() => {
    const workflowContainer = document.getElementById('workflow-container')
    const {
      clientWidth,
      clientHeight,
    } = workflowContainer!

    const {
      setViewport,
    } = reactflow
    const { transform } = store.getState()
    const zoom = transform[2]
    const position = node.position
    setViewport({
      x: (clientWidth - 400 - node.width! * zoom) / 2 - position!.x * zoom,
      y: (clientHeight - node.height! * zoom) / 2 - position!.y * zoom,
      zoom: transform[2],
    })
  }, [node, reactflow, store])

  const Item = (
    <VariableLabelInEditor
      nodeType={node?.type}
      nodeTitle={node?.title}
      variables={variables}
      onClick={(e) => {
        e.stopPropagation()
        handleVariableJump()
      }}
      isExceptionVariable={isException}
      errorMsg={!variableValid ? t('errorMsg.invalidVariable', { ns: 'workflow' }) : undefined}
      isSelected={isSelected}
      ref={ref}
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

export default memo(WorkflowVariableBlockComponent)
