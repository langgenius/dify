import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Props as FormProps } from '@/app/components/workflow/nodes/_base/components/before-run-form/form'
import type { InputVar } from '@/app/components/workflow/types'
import type { HumanInputNodeType } from './types'
import useNodeCrud from '../_base/hooks/use-node-crud'
import { isOutput } from './utils'

const i18nPrefix = 'workflow.nodes.humanInput'

type Params = {
  id: string,
  payload: HumanInputNodeType,
  runInputData: Record<string, any>
  getInputVars: (textList: string[]) => InputVar[]
  setRunInputData: (data: Record<string, any>) => void
}
const useSingleRunFormParams = ({
  id,
  payload,
  runInputData,
  getInputVars,
  setRunInputData,
}: Params) => {
  const { t } = useTranslation()
  const { inputs } = useNodeCrud<HumanInputNodeType>(id, payload)
  const [submittedData, setSubmittedData] = useState<Record<string, any> | null>(null)
  const [showGeneratedForm, setShowGeneratedForm] = useState(false)
  const generatedInputs = useMemo(() => {
    if (!inputs.form_content)
      return []
    return getInputVars([inputs.form_content]).filter(item => !isOutput(item.value_selector || []))
  }, [inputs.form_content])

  const forms = useMemo(() => {
    const forms: FormProps[] = [{
      label: t(`${i18nPrefix}.singleRun.label`)!,
      inputs: generatedInputs,
      values: runInputData,
      onChange: setRunInputData,
    }]
    return forms
  }, [runInputData, setRunInputData, generatedInputs])

  const formContentOutputFields = useMemo(() => {
    const res = (inputs.inputs || [])
      .filter((item) => {
        return inputs.form_content.includes(`{{#$output.${item.output_variable_name}#}}`)
      })
      .map((item) => {
        return {
          type: item.type,
          output_variable_name: item.output_variable_name,
          placeholder: item.placeholder?.type === 'const' ? item.placeholder.value : '',
        }
      })
      return res
  }, [inputs.form_content, inputs.inputs])

  const getDependentVars = () => {
    return generatedInputs.map((item) => {
      // Guard against null/undefined variable to prevent app crash
      if (!item.variable || typeof item.variable !== 'string')
        return []

      return item.variable.slice(1, -1).split('.')
    }).filter(arr => arr.length > 0)
  }

  const generatedFormContentData = useMemo(() => {
    if (!inputs.form_content)
      return null
    if (!generatedInputs.length) {
      return {
        formContent: inputs.form_content,
        inputFields: formContentOutputFields,
        userActions: inputs.user_actions,
        showBackButton: false,
      }
    }
    else {
      if (!submittedData)
        return null
      const newContent = inputs.form_content.replace(/{{#(.*?)#}}/g, (originStr, varName) => {
        if (isOutput(varName.split('.')))
          return originStr
        return submittedData[`#${varName}#`] ?? ''
      })
      return {
        formContent: newContent,
        inputFields: formContentOutputFields,
        userActions: inputs.user_actions,
        showBackButton: true,
      }
    }
  }, [inputs.form_content, inputs.user_actions, submittedData, formContentOutputFields])

  const handleShowGeneratedForm = (formValue: Record<string, any>) => {
    setSubmittedData(formValue)
    setShowGeneratedForm(true)
  }

  const handleHideGeneratedForm = () => {
    setShowGeneratedForm(false)
  }

  return {
    forms,
    getDependentVars,
    generatedFormContentData,
    showGeneratedForm,
    handleShowGeneratedForm,
    handleHideGeneratedForm,
  }
}

export default useSingleRunFormParams
