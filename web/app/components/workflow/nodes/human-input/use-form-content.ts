import useNodeCrud from '../_base/hooks/use-node-crud'
import type { FormInputItem, HumanInputNodeType } from './types'

const useFormContent = (id: string, payload: HumanInputNodeType) => {
  const { inputs, setInputs } = useNodeCrud<HumanInputNodeType>(id, payload)
  const handleFormContentChange = (value: string) => {
    setInputs({
      ...inputs,
      form_content: value,
    })
  }

  const handleFormInputsChange = (formInputs: FormInputItem[]) => {
    setInputs({
      ...inputs,
      inputs: formInputs,
    })
  }
  return {
    handleFormContentChange,
    handleFormInputsChange,
  }
}

export default useFormContent
