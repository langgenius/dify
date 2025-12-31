import type { RefObject } from 'react'
import type { QuestionClassifierNodeType } from './types'
import type { Props as FormProps } from '@/app/components/workflow/nodes/_base/components/before-run-form/form'
import type { InputVar, Var, Variable } from '@/app/components/workflow/types'
import { noop } from 'es-toolkit/function'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { InputVarType, VarType } from '@/app/components/workflow/types'
import useConfigVision from '../../hooks/use-config-vision'
import useAvailableVarList from '../_base/hooks/use-available-var-list'
import useNodeCrud from '../_base/hooks/use-node-crud'
import { findVariableWhenOnLLMVision } from '../utils'

const i18nPrefix = 'nodes.questionClassifiers'

type Params = {
  id: string
  payload: QuestionClassifierNodeType
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
  runInputDataRef,
  getInputVars,
  setRunInputData,
}: Params) => {
  const { t } = useTranslation()
  const { inputs } = useNodeCrud<QuestionClassifierNodeType>(id, payload)

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
      .filter(key => !['#files#'].includes(key))
      .forEach((key) => {
        vars[key] = runInputData[key]
      })
    return vars
  })()

  const setInputVarValues = useCallback((newPayload: Record<string, any>) => {
    const newVars = {
      ...newPayload,
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
        label: t('nodes.llm.singleRun.variable', { ns: 'workflow' })!,
        inputs: [{
          label: t(`${i18nPrefix}.inputVars`, { ns: 'workflow' })!,
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
          label: t('nodes.llm.vision', { ns: 'workflow' })!,
          inputs: [{
            label: currentVariable?.variable as any,
            variable: '#files#',
            type: currentVariable?.formType as any,
            required: false,
          }],
          values: { '#files#': visionFiles },
          onChange: keyValue => setVisionFiles(keyValue['#files#']),
        },
      )
    }
    return forms
  })()

  const getDependentVars = () => {
    const promptVars = varInputs.map((item) => {
      // Guard against null/undefined variable to prevent app crash
      if (!item.variable || typeof item.variable !== 'string')
        return []

      return item.variable.slice(1, -1).split('.')
    }).filter(arr => arr.length > 0)
    const vars = [payload.query_variable_selector, ...promptVars]
    if (isVisionModel && payload.vision?.enabled && payload.vision?.configs?.variable_selector) {
      const visionVar = payload.vision.configs.variable_selector
      vars.push(visionVar)
    }
    return vars
  }

  const getDependentVar = (variable: string) => {
    if (variable === 'query')
      return payload.query_variable_selector
    if (variable === '#files#')
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
