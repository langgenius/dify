import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import {
  COMMAND_PRIORITY_EDITOR,
} from 'lexical'
import { mergeRegister } from '@lexical/utils'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { useReactFlow, useStoreApi } from 'reactflow'
import { useSelectOrDelete } from '../../hooks'
import type { WorkflowNodesMap } from './node'
import { WorkflowVariableBlockNode } from './node'
import {
  DELETE_WORKFLOW_VARIABLE_BLOCK_COMMAND,
  UPDATE_WORKFLOW_NODES_MAP,
} from './index'
import { isConversationVar as isConversationVariable, isENV, isMemoryVariable, isRagVariableVar, isSystemVar } from '@/app/components/workflow/nodes/_base/components/variable/utils'
import Tooltip from '@/app/components/base/tooltip'
import { isExceptionVariable } from '@/app/components/workflow/utils'
import VarFullPathPanel from '@/app/components/workflow/nodes/_base/components/variable/var-full-path-panel'
import { Type } from '@/app/components/workflow/nodes/llm/types'
import type { ValueSelector, Var } from '@/app/components/workflow/types'
import {
  VariableLabelInEditor,
} from '@/app/components/workflow/nodes/_base/components/variable/variable-label'

type WorkflowVariableBlockComponentProps = {
  nodeKey: string
  variables: string[]
  workflowNodesMap: WorkflowNodesMap
  environmentVariables?: Var[]
  conversationVariables?: Var[]
  ragVariables?: Var[]
  getVarType?: (payload: {
    nodeId: string,
    valueSelector: ValueSelector,
  }) => Type
  isMemorySupported?: boolean
}

const WorkflowVariableBlockComponent = ({
  nodeKey,
  variables,
  workflowNodesMap = {},
  getVarType,
  environmentVariables,
  conversationVariables,
  ragVariables,
  isMemorySupported,
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
  const isEnv = isENV(variables)
  const isConversationVar = isConversationVariable(variables)
  const isMemoryVar = isMemoryVariable(variables)
  const isException = isExceptionVariable(varName, node?.type)

  const memoryVariables = conversationVariables?.filter(v => v.variable.startsWith('memory_block.'))

  let variableValid = true
  if (isEnv) {
    if (environmentVariables)
      variableValid = environmentVariables.some(v => v.variable === `${variables?.[0] ?? ''}.${variables?.[1] ?? ''}`)
  }
  else if (isConversationVar) {
    if (conversationVariables)
      variableValid = conversationVariables.some(v => v.variable === `${variables?.[0] ?? ''}.${variables?.[1] ?? ''}`)
  }
  else if (isMemoryVar) {
    if (memoryVariables)
      variableValid = memoryVariables.some(v => v.variable === `${variables?.[0] ?? ''}.${variables?.[1] ?? ''}`)

    if (!isMemorySupported)
      variableValid = false
  }
  else if (isRagVar) {
    if (ragVariables)
      variableValid = ragVariables.some(v => v.variable === `${variables?.[0] ?? ''}.${variables?.[1] ?? ''}.${variables?.[2] ?? ''}`)
  }
  else {
    variableValid = !!node
  }

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

  const memoriedVariables = useMemo(() => {
    if (variables[0] === 'memory_block') {
      const currentMemoryVariable = memoryVariables?.find(v => v.variable === variables.join('.'))

      if (currentMemoryVariable && currentMemoryVariable.memoryVariableName) {
        return [
          'memory_block',
          currentMemoryVariable.memoryVariableName,
        ]
      }

      return variables
    }

    return variables
  }, [memoryVariables, variables])

  const Item = (
    <VariableLabelInEditor
      nodeType={node?.type}
      nodeTitle={node?.title}
      variables={memoriedVariables}
      onClick={(e) => {
        e.stopPropagation()
        handleVariableJump()
      }}
      isExceptionVariable={isException}
      errorMsg={!variableValid ? t('workflow.errorMsg.invalidVariable') : undefined}
      isSelected={isSelected}
      ref={ref}
      notShowFullPath={isShowAPart}
    />
  )

  if (!node)
    return <div>{Item}</div>

  return (
    <Tooltip
      noDecoration
      popupContent={
        <VarFullPathPanel
          nodeName={node.title}
          path={memoriedVariables.slice(1)}
          varType={getVarType ? getVarType({
            nodeId: memoriedVariables[0],
            valueSelector: memoriedVariables,
          }) : Type.string}
          nodeType={node?.type}
        />}
      disabled={!isShowAPart}
    >
      <div>{Item}</div>
    </Tooltip>
  )
}

export default memo(WorkflowVariableBlockComponent)
