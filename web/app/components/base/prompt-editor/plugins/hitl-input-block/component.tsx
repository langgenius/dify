import type { FC } from 'react'
import type { WorkflowNodesMap } from '../workflow-variable-block/node'
import type { FormInputItem } from '@/app/components/workflow/nodes/human-input/types'
import type { Type } from '@/app/components/workflow/nodes/llm/types'
import type { ValueSelector, Var } from '@/app/components/workflow/types'
import { produce } from 'immer'
import { useCallback } from 'react'
import { useSelectOrDelete } from '../../hooks'
import { DELETE_HITL_INPUT_BLOCK_COMMAND } from './'
import ComponentUi from './component-ui'

type HITLInputComponentProps = {
  nodeKey: string
  nodeId: string
  varName: string
  formInputs?: FormInputItem[]
  onChange: (inputs: FormInputItem[]) => void
  onRename: (payload: FormInputItem, oldName: string) => void
  onRemove: (varName: string) => void
  workflowNodesMap: WorkflowNodesMap
  environmentVariables?: Var[]
  conversationVariables?: Var[]
  ragVariables?: Var[]
  getVarType?: (payload: {
    nodeId: string
    valueSelector: ValueSelector
  }) => Type
  readonly?: boolean
}

const HITLInputComponent: FC<HITLInputComponentProps> = ({
  nodeKey,
  nodeId,
  varName,
  formInputs = [],
  onChange,
  onRename,
  onRemove,
  workflowNodesMap = {},
  getVarType,
  environmentVariables,
  conversationVariables,
  ragVariables,
  readonly,
}) => {
  const [ref] = useSelectOrDelete(nodeKey, DELETE_HITL_INPUT_BLOCK_COMMAND)
  const payload = formInputs.find(item => item.output_variable_name === varName)

  const handleChange = useCallback((newPayload: FormInputItem) => {
    if (!payload) {
      onChange([...formInputs, newPayload])
      return
    }
    if (payload?.output_variable_name !== newPayload.output_variable_name) {
      onChange(produce(formInputs, (draft) => {
        draft.splice(draft.findIndex(item => item.output_variable_name === payload?.output_variable_name), 1, newPayload)
      }))
      return
    }
    onChange(formInputs.map(item => item.output_variable_name === varName ? newPayload : item))
  }, [formInputs, onChange, payload, varName])

  return (
    <div
      ref={ref}
      className="w-full pb-1 pt-3"
    >
      <ComponentUi
        nodeId={nodeId}
        varName={varName}
        formInput={payload}
        onChange={handleChange}
        onRename={onRename}
        onRemove={onRemove}
        workflowNodesMap={workflowNodesMap}
        getVarType={getVarType}
        environmentVariables={environmentVariables}
        conversationVariables={conversationVariables}
        ragVariables={ragVariables}
        readonly={readonly}
      />
    </div>
  )
}

export default HITLInputComponent
