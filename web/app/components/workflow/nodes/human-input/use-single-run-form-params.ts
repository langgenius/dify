import { useTranslation } from 'react-i18next'
import type { Props as FormProps } from '@/app/components/workflow/nodes/_base/components/before-run-form/form'
import type { InputVar } from '@/app/components/workflow/types'
import type { HumanInputNodeType } from './types'
import useNodeCrud from '../_base/hooks/use-node-crud'
import { useMemo } from 'react'
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

  const getDependentVars = () => {
    return generatedInputs.map((item) => {
      // Guard against null/undefined variable to prevent app crash
      if (!item.variable || typeof item.variable !== 'string')
        return []

      return item.variable.slice(1, -1).split('.')
    }).filter(arr => arr.length > 0)
  }

  return {
    forms,
    getDependentVars,
  }
}

export default useSingleRunFormParams
