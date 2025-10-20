import { useCallback, useEffect, useRef, useState } from 'react'
import useNodeCrud from '../_base/hooks/use-node-crud'
import type { FormInputItem, HumanInputNodeType } from './types'
import { produce } from 'immer'

const useFormContent = (id: string, payload: HumanInputNodeType) => {
  const [editorKey, setEditorKey] = useState(0)
  const { inputs, setInputs } = useNodeCrud<HumanInputNodeType>(id, payload)
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
      if(!draft.inputs.find(item => item.output_variable_name === payload.output_variable_name))
        draft.inputs = [...draft.inputs, payload]
    })
    setInputs(newInputs)
    setEditorKey(editorKey => editorKey + 1)
  }, [setInputs])

  const handleFormInputItemRemove = useCallback((varName: string) => {
    const inputs = inputsRef.current
    const newInputs = produce(inputs, (draft) => {
      draft.form_content = draft.form_content.replaceAll(`{{#$output.${varName}#}}`, '')
      draft.inputs = draft.inputs.filter(item => item.output_variable_name !== varName)
    })
    setInputs(newInputs)
    setEditorKey(editorKey => editorKey + 1)
  }, [setInputs, editorKey])

  return {
    editorKey,
    handleFormContentChange,
    handleFormInputsChange,
    handleFormInputItemRename,
    handleFormInputItemRemove,
  }
}

export default useFormContent
