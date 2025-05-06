import type { MutableRefObject } from 'react'
import { useTranslation } from 'react-i18next'
import type { Props as FormProps } from '@/app/components/workflow/nodes/_base/components/before-run-form/form'
import { type InputVar, InputVarType, type Variable } from '@/app/components/workflow/types'
import type { StartNodeType } from './types'
import { useIsChatMode } from '../../hooks'

type Params = {
  id: string,
  payload: StartNodeType,
  runInputData: Record<string, any>
  runInputDataRef: MutableRefObject<Record<string, any>>
  getInputVars: (textList: string[]) => InputVar[]
  setRunInputData: (data: Record<string, any>) => void
  toVarInputs: (variables: Variable[]) => InputVar[]
}
const useSingleRunFormParams = ({
  payload,
  runInputData,
  setRunInputData,
}: Params) => {
  const { t } = useTranslation()
  const isChatMode = useIsChatMode()

  const forms = (() => {
    const forms: FormProps[] = []
    const inputs = payload.variables.map((item: InputVar) => ({
      label: item.variable,
      variable: item.variable,
      type: item.type,
      required: item.required,
    }))

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
        label: t('workflow.nodes.llm.singleRun.variable')!,
        inputs,
        values: runInputData,
        onChange: setRunInputData,
      },
    )

    return forms
  })()

  return {
    forms,
  }
}

export default useSingleRunFormParams
