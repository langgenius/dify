import type { MutableRefObject } from 'react'
import { useTranslation } from 'react-i18next'
import type { Props as FormProps } from '@/app/components/workflow/nodes/_base/components/before-run-form/form'
import type { InputVar, Var, Variable } from '@/app/components/workflow/types'
import { InputVarType, VarType } from '@/app/components/workflow/types'
import type { ParameterExtractorNodeType } from './types'
import useNodeCrud from '../_base/hooks/use-node-crud'
import { useCallback } from 'react'
import useConfigVision from '../../hooks/use-config-vision'
import { noop } from 'lodash-es'
import { findVariableWhenOnLLMVision } from '../utils'
import useAvailableVarList from '../_base/hooks/use-available-var-list'

const i18nPrefix = 'workflow.nodes.parameterExtractor'

type Params = {
  id: string,
  payload: ParameterExtractorNodeType,
  runInputData: Record<string, any>
  runInputDataRef: MutableRefObject<Record<string, any>>
  getInputVars: (textList: string[]) => InputVar[]
  setRunInputData: (data: Record<string, any>) => void
  toVarInputs: (variables: Variable[]) => InputVar[]
}
const useSingleRunFormParams = ({
  id,
  payload,
  runInputData,
  runInputDataRef,
  getInputVars,
  setRunInputData,
}: Params) => {
  const { t } = useTranslation()
  const { inputs } = useNodeCrud<ParameterExtractorNodeType>(id, payload)

  const model = inputs.model

  const {
    isVisionModel,
  } = useConfigVision(model, {
    payload: inputs.vision,
    onChange: noop,
  })

  const visionFiles = runInputData['#files#']
  const setVisionFiles = useCallback((newFiles: any[]) => {
    setRunInputData?.({
      ...runInputDataRef.current,
      '#files#': newFiles,
    })
  }, [runInputDataRef, setRunInputData])

  const varInputs = getInputVars([inputs.instruction])

  const inputVarValues = (() => {
    const vars: Record<string, any> = {}
    Object.keys(runInputData)
      .filter(key => !['#context#', '#files#'].includes(key))
      .forEach((key) => {
        vars[key] = runInputData[key]
      })
    return vars
  })()

  const setInputVarValues = useCallback((newPayload: Record<string, any>) => {
    const newVars = {
      ...newPayload,
      '#context#': runInputDataRef.current['#context#'],
      '#files#': runInputDataRef.current['#files#'],
    }
    setRunInputData?.(newVars)
  }, [runInputDataRef, setRunInputData])

  const filterVisionInputVar = useCallback((varPayload: Var) => {
    return [VarType.file, VarType.arrayFile].includes(varPayload.type)
  }, [])
  const {
    availableVars: availableVisionVars,
  } = useAvailableVarList(id, {
    onlyLeafNodeVar: false,
    filterVar: filterVisionInputVar,
  })

  const forms = (() => {
    const forms: FormProps[] = []

    forms.push(
      {
        label: t('workflow.nodes.llm.singleRun.variable')!,
        inputs: [{
          label: t(`${i18nPrefix}.inputVar`)!,
          variable: 'query',
          type: InputVarType.paragraph,
          required: true,
        }, ...varInputs],
        values: inputVarValues,
        onChange: setInputVarValues,
      },
    )

    if (isVisionModel && payload.vision?.enabled && payload.vision?.configs?.variable_selector) {
      const currentVariable = findVariableWhenOnLLMVision(payload.vision.configs.variable_selector, availableVisionVars)

      forms.push(
        {
          label: t('workflow.nodes.llm.vision')!,
          inputs: [{
            label: currentVariable?.variable as any,
            variable: '#files#',
            type: currentVariable?.formType as any,
            required: false,
          }],
          values: { '#files#': visionFiles },
          onChange: keyValue => setVisionFiles((keyValue as any)['#files#']),
        },
      )
    }

    return forms
  })()

  const getDependentVars = () => {
    const promptVars = varInputs.map(item => item.variable.slice(1, -1).split('.'))
    const vars = [payload.query, ...promptVars]
    if (isVisionModel && payload.vision?.enabled && payload.vision?.configs?.variable_selector) {
      const visionVar = payload.vision.configs.variable_selector
      vars.push(visionVar)
    }
    return vars
  }

  const getDependentVar = (variable: string) => {
    if(variable === 'query')
      return payload.query
    if(variable === '#files#')
      return payload.vision.configs?.variable_selector

    return false
  }

  return {
    forms,
    getDependentVars,
    getDependentVar,
  }
}

export default useSingleRunFormParams
