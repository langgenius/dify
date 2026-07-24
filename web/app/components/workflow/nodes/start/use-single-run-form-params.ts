import type { RefObject } from 'react'
import type { StartNodeType } from './types'
import type { Props as FormProps } from '@/app/components/workflow/nodes/_base/components/before-run-form/form'
import type { InputVar, ValueSelector, Variable } from '@/app/components/workflow/types'
import { useTranslation } from 'react-i18next'
import { InputVarType } from '@/app/components/workflow/types'
import { useIsChatMode } from '../../hooks'

type Params = {
  id: string
  payload: StartNodeType
  runInputData: Record<string, any>
  runInputDataRef: RefObject<Record<string, any>>
  getInputVars: (textList: string[]) => InputVar[]
  setRunInputData: (data: Record<string, any>) => void
  toVarInputs: (variables: Variable[]) => InputVar[]
}
const useSingleRunFormParams = ({
  id,
  payload,
  runInputData,
  setRunInputData,
}: Params) => {
  const { t } = useTranslation()
  const isChatMode = useIsChatMode()

  const forms = (() => {
    const forms: FormProps[] = []
    const inputs: InputVar[] = payload.variables.map((item) => {
      return {
        ...item,
        getVarValueFromDependent: true,
      }
    })

    if (isChatMode) {
      inputs.push({
        label: 'sys.query',
        variable: '#sys.query#',
        type: InputVarType.textInput,
        required: true,
      })
    }

    inputs.push({
      label: 'sys.files',
      variable: '#sys.files#',
      type: InputVarType.multiFiles,
      required: false,
    })

    forms.push(
      {
        label: t('nodes.llm.singleRun.variable', { ns: 'workflow' })!,
        inputs,
        values: runInputData,
        onChange: setRunInputData,
      },
    )

    return forms
  })()

  const getDependentVars = () => {
    const inputVars = payload.variables.map((item) => {
      return [id, item.variable]
    })
    const vars: ValueSelector[] = [...inputVars, ['sys', 'files']]

    if (isChatMode)
      vars.push(['sys', 'query'])

    return vars
  }

  const getDependentVar = (variable: string) => {
    return [id, variable]
  }

  return {
    forms,
    getDependentVars,
    getDependentVar,
  }
}

export default useSingleRunFormParams
