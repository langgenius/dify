import type {
  UpdateWorkflowNodesMapPayload,
} from './index'
import type { WorkflowNodesMap } from './node'
import type { NodeOutPutVar, ValueSelector, Var } from '@/app/components/workflow/types'
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
import { Tooltip, TooltipContent, TooltipTrigger } from '@/app/components/base/ui/tooltip'
import { isRagVariableVar, isSpecialVar, isSystemVar } from '@/app/components/workflow/nodes/_base/components/variable/utils'
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
import { useLlmModelPluginInstalled } from './use-llm-model-plugin-installed'

type WorkflowVariableBlockComponentProps = {
  nodeKey: string
  variables: string[]
  workflowNodesMap: WorkflowNodesMap
  availableVariables?: NodeOutPutVar[]
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
  availableVariables,
  getVarType,
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
  const [localAvailableVariables, setLocalAvailableVariables] = useState<NodeOutPutVar[]>(availableVariables || [])
  const node = localWorkflowNodesMap![variables[isRagVar ? 1 : 0]!]

  const isException = isExceptionVariable(varName, node?.type)
  const sourceNodeId = variables[isRagVar ? 1 : 0]
  const isLlmModelInstalled = useLlmModelPluginInstalled(sourceNodeId!, localWorkflowNodesMap)
  const variableValid = useMemo(() => {
    if (isSpecialVar(variables[0] ?? ''))
      return true

    if (!variables[1])
      return false

    const sourceNode = localAvailableVariables.find(v => v.nodeId === variables[0])
    if (!sourceNode)
      return false

    return sourceNode.vars.some(v => v.variable === variables[1])
  }, [localAvailableVariables, variables])

  const reactflow = useReactFlow()
  const store = useStoreApi()

  useEffect(() => {
    if (!editor.hasNodes([WorkflowVariableBlockNode]))
      throw new Error('WorkflowVariableBlockPlugin: WorkflowVariableBlock not registered on editor')

    return mergeRegister(
      editor.registerCommand(
        UPDATE_WORKFLOW_NODES_MAP,
        (payload: UpdateWorkflowNodesMapPayload) => {
          setLocalWorkflowNodesMap(payload.workflowNodesMap)
          setLocalAvailableVariables(payload.availableVariables)
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
    const position = node!.position
    setViewport({
      x: (clientWidth - 400 - node!.width! * zoom) / 2 - position!.x * zoom,
      y: (clientHeight - node!.height! * zoom) / 2 - position!.y * zoom,
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
      errorMsg={
        !variableValid
          ? t('errorMsg.invalidVariable', { ns: 'workflow' })
          : !isLlmModelInstalled
              ? t('errorMsg.modelPluginNotInstalled', { ns: 'workflow' })
              : undefined
      }
      isSelected={isSelected}
      ref={ref}
      notShowFullPath={isShowAPart}
    />
  )

  if (!node)
    return Item

  return (
    <Tooltip>
      <TooltipTrigger disabled={!isShowAPart} render={<div>{Item}</div>} />
      <TooltipContent variant="plain">
        <VarFullPathPanel
          nodeName={node.title}
          path={variables.slice(1)}
          varType={getVarType
            ? getVarType({
                nodeId: variables[0]!,
                valueSelector: variables,
              })
            : Type.string}
          nodeType={node?.type}
        />
      </TooltipContent>
    </Tooltip>
  )
}

export default memo(WorkflowVariableBlockComponent)
