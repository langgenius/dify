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
import { isConversationVar, isENV, isGlobalVar, isMemoryVariable, isRagVariableVar, isSystemVar } from '@/app/components/workflow/nodes/_base/components/variable/utils'
import Tooltip from '@/app/components/base/tooltip'
import { isExceptionVariable } from '@/app/components/workflow/utils'
import VarFullPathPanel from '@/app/components/workflow/nodes/_base/components/variable/var-full-path-panel'
import { Type } from '@/app/components/workflow/nodes/llm/types'
import type {
  NodeOutPutVar,
  ValueSelector,
} from '@/app/components/workflow/types'
import {
  VariableLabelInEditor,
} from '@/app/components/workflow/nodes/_base/components/variable/variable-label'
import { useEventEmitterContextContext } from '@/context/event-emitter'
import { UPDATE_WORKFLOW_VARIABLES_EVENT_EMITTER } from '../../constants'
import { usePromptEditorStore } from '../../store/store'

type WorkflowVariableBlockComponentProps = {
  nodeKey: string
  variables: string[]
  workflowNodesMap: WorkflowNodesMap
  availableVariables: NodeOutPutVar[]
  getVarType?: (payload: {
    nodeId: string,
    valueSelector: ValueSelector,
  }) => Type
}

const WorkflowVariableBlockComponent = ({
  nodeKey,
  variables,
  workflowNodesMap = {},
  getVarType,
  availableVariables: initialAvailableVariables,
}: WorkflowVariableBlockComponentProps) => {
  const { t } = useTranslation()
  const [editor] = useLexicalComposerContext()
  const instanceId = usePromptEditorStore(s => s.instanceId)
  const { eventEmitter } = useEventEmitterContextContext()
  const [availableVariables, setAvailableVariables] = useState<NodeOutPutVar[]>(initialAvailableVariables)
  eventEmitter?.useSubscription((v: any) => {
    if (v?.type === UPDATE_WORKFLOW_VARIABLES_EVENT_EMITTER && instanceId && v.instanceId === instanceId)
      setAvailableVariables(v.payload)
  })
  const environmentVariables = availableVariables?.find(v => v.nodeId === 'env')?.vars || []
  const conversationVariables = availableVariables?.find(v => v.nodeId === 'conversation')?.vars || []
  const memoryVariables = conversationVariables?.filter(v => v.variable.startsWith('memory_block.'))
  const ragVariables = availableVariables?.reduce<any[]>((acc, curr) => {
    if (curr.nodeId === 'rag')
      acc.push(...curr.vars)
    else
      acc.push(...curr.vars.filter(v => v.isRagVariable))
    return acc
  }, [])
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
    const isMemoryVar = isMemoryVariable(variables)
    const isGlobal = isGlobalVar(variables)
    if (isGlobal)
      return true

    if (isEnv) {
      variableValid
        = environmentVariables.some(v => v.variable === `${variables?.[0] ?? ''}.${variables?.[1] ?? ''}`)
    }
    else if (isChatVar) {
      variableValid = conversationVariables.some(v => v.variable === `${variables?.[0] ?? ''}.${variables?.[1] ?? ''}`)
    }
    else if (isMemoryVar) {
      variableValid = memoryVariables.some(v => v.variable === `${variables?.[0] ?? ''}.${variables?.[1] ?? ''}`)
    }
    else if (isRagVar) {
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
