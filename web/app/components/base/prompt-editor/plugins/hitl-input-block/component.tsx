import { type FC, useCallback } from 'react'
import { useSelectOrDelete } from '../../hooks'
import { DELETE_HITL_INPUT_BLOCK_COMMAND } from './'
import ComponentUi from './component-ui'
import type { FormInputItem } from '@/app/components/workflow/nodes/human-input/types'
import { produce } from 'immer'

type Props = {
  nodeKey: string
  nodeId: string
  nodeTitle: string
  varName: string
  formInputs?: FormInputItem[]
  onChange: (inputs: FormInputItem[]) => void
  onRename: (payload: FormInputItem, oldName: string) => void
  onRemove: (varName: string) => void
}

const HITLInputComponent: FC<Props> = ({
  nodeKey,
  nodeId,
  nodeTitle,
  varName,
  formInputs = [],
  onChange,
  onRename,
  onRemove,
}) => {
  const [ref, isSelected] = useSelectOrDelete(nodeKey, DELETE_HITL_INPUT_BLOCK_COMMAND)
  const payload = formInputs.find(item => item.output_variable_name === varName)
  const handleChange = useCallback((newPayload: FormInputItem) => {
    if(!payload) {
      onChange([...formInputs, newPayload])
      return
    }
    if(payload?.output_variable_name !== newPayload.output_variable_name) {
      onChange(produce(formInputs, (draft) => {
        draft.splice(draft.findIndex(item => item.output_variable_name === payload?.output_variable_name), 1, newPayload)
      }))
      return
    }
    onChange(formInputs.map(item => item.output_variable_name === varName ? newPayload : item))
  }, [onChange])
  return (
    <div
      ref={ref}
      className='w-full pb-1 pt-3'
    >
      <ComponentUi
        nodeId={nodeId}
        nodeTitle={nodeTitle}
        varName={varName}
        isSelected={isSelected}
        formInput={payload}
        onChange={handleChange}
        onRename={onRename}
        onRemove={onRemove}
      />
    </div>
  )
}

export default HITLInputComponent
