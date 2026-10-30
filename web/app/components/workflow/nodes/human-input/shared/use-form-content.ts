import type { FormInputItem, HumanInputSharedNodeType } from './types'
import { produce } from 'immer'
import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import { useWorkflow } from '@/app/components/workflow/hooks/use-workflow'
import useNodeCrud from '../../_base/hooks/use-node-crud'

const useHumanInputFormContent = <T extends HumanInputSharedNodeType>(id: string, payload: T) => {
  const [editorKey, setEditorKey] = useState(0)
  const { inputs, setInputs } = useNodeCrud<T>(id, payload)
  const { handleOutVarRenameChange } = useWorkflow()
  // Existing Lexical blocks retain callbacks, so edits must read the latest node data.
  const inputsRef = useRef(inputs)

  // Refresh before FormContent's passive effect persists newly inserted fields.
  useLayoutEffect(() => {
    inputsRef.current = inputs
  }, [inputs])

  const handleFormContentChange = useCallback(
    (value: string) => {
      setInputs({
        ...inputsRef.current,
        form_content: value,
      })
    },
    [setInputs],
  )

  const handleFormInputsChange = useCallback(
    (formInputs: FormInputItem[]) => {
      setInputs({
        ...inputsRef.current,
        inputs: formInputs,
      })
      setEditorKey((editorKey) => editorKey + 1)
    },
    [setInputs],
  )

  const handleFormInputItemRename = useCallback(
    (payload: FormInputItem, oldName: string) => {
      const inputs = inputsRef.current
      if (
        oldName !== payload.output_variable_name &&
        inputs.inputs.some((item) => item.output_variable_name === payload.output_variable_name)
      )
        return

      const newInputs = produce(inputs, (draft) => {
        draft.form_content = draft.form_content.replaceAll(
          `{{#$output.${oldName}#}}`,
          `{{#$output.${payload.output_variable_name}#}}`,
        )
        draft.inputs = draft.inputs.map((item) =>
          item.output_variable_name === oldName ? payload : item,
        )
        if (
          !draft.inputs.some((item) => item.output_variable_name === payload.output_variable_name)
        )
          draft.inputs = [...draft.inputs, payload]
      })
      setInputs(newInputs)
      setEditorKey((editorKey) => editorKey + 1)

      if (oldName !== payload.output_variable_name)
        handleOutVarRenameChange(id, [id, oldName], [id, payload.output_variable_name])
    },
    [handleOutVarRenameChange, id, setInputs],
  )

  const handleFormInputItemRemove = useCallback(
    (varName: string) => {
      const inputs = inputsRef.current
      const newInputs = produce(inputs, (draft) => {
        draft.form_content = draft.form_content.replaceAll(`{{#$output.${varName}#}}`, '')
        draft.inputs = draft.inputs.filter((item) => item.output_variable_name !== varName)
      })
      setInputs(newInputs)
      setEditorKey((editorKey) => editorKey + 1)
    },
    [setInputs],
  )

  return {
    editorKey,
    handleFormContentChange,
    handleFormInputsChange,
    handleFormInputItemRename,
    handleFormInputItemRemove,
  }
}

export default useHumanInputFormContent
