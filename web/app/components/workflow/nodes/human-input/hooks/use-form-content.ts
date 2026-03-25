import type { FormInputItem, HumanInputNodeType } from '../types'
import { produce } from 'immer'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useWorkflow } from '@/app/components/workflow/hooks'
import useNodeCrud from '../../_base/hooks/use-node-crud'

const useFormContent = (id: string, payload: HumanInputNodeType) => {
  const [editorKey, setEditorKey] = useState(0)
  const { inputs, setInputs } = useNodeCrud<HumanInputNodeType>(id, payload)
  const { handleOutVarRenameChange } = useWorkflow()
  const inputsRef = useRef(inputs)
  useEffect(() => {
    inputsRef.current = inputs
  }, [inputs])
  const handleFormContentChange = useCallback((value: string) => {
    setInputs({
      ...inputs,
      form_content: value,
    })
  }, [inputs, setInputs])

  const handleFormInputsChange = useCallback((formInputs: FormInputItem[]) => {
    setInputs({
      ...inputs,
      inputs: formInputs,
    })
    setEditorKey(editorKey => editorKey + 1)
  }, [inputs, setInputs])

  const handleFormInputItemRename = useCallback((payload: FormInputItem, oldName: string) => {
    const inputs = inputsRef.current
    const newInputs = produce(inputs, (draft) => {
      draft.form_content = draft.form_content.replaceAll(`{{#$output.${oldName}#}}`, `{{#$output.${payload.output_variable_name}#}}`)
      draft.inputs = draft.inputs.map(item => item.output_variable_name === oldName ? payload : item)
      if (!draft.inputs.find(item => item.output_variable_name === payload.output_variable_name))
        draft.inputs = [...draft.inputs, payload]
    })
    setInputs(newInputs)
    setEditorKey(editorKey => editorKey + 1)

    // Update downstream nodes that reference this variable
    if (oldName !== payload.output_variable_name)
      handleOutVarRenameChange(id, [id, oldName], [id, payload.output_variable_name])
  }, [setInputs, handleOutVarRenameChange, id])

  const handleFormInputItemRemove = useCallback((varName: string) => {
    const inputs = inputsRef.current
    const newInputs = produce(inputs, (draft) => {
      draft.form_content = draft.form_content.replaceAll(`{{#$output.${varName}#}}`, '')
      draft.inputs = draft.inputs.filter(item => item.output_variable_name !== varName)
    })
    setInputs(newInputs)
    setEditorKey(editorKey => editorKey + 1)
  }, [setInputs])

  return {
    editorKey,
    handleFormContentChange,
    handleFormInputsChange,
    handleFormInputItemRename,
    handleFormInputItemRemove,
  }
}

export default useFormContent
