import type { RefObject } from 'react'
import { useTranslation } from 'react-i18next'
import type { Props as FormProps } from '@/app/components/workflow/nodes/_base/components/before-run-form/form'
import type { InputVar, PromptItem, Var, Variable } from '@/app/components/workflow/types'
import { InputVarType, VarType } from '@/app/components/workflow/types'
import type { LLMNodeType } from './types'
import { EditionType } from '../../types'
import useNodeCrud from '../_base/hooks/use-node-crud'
import { useIsChatMode } from '../../hooks'
import { useCallback } from 'react'
import useConfigVision from '../../hooks/use-config-vision'
import { noop } from 'lodash-es'
import { findVariableWhenOnLLMVision } from '../utils'
import useAvailableVarList from '../_base/hooks/use-available-var-list'

const i18nPrefix = 'workflow.nodes.llm'
type Params = {
  id: string,
  payload: LLMNodeType,
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
  toVarInputs,
}: Params) => {
  const { t } = useTranslation()
  const { inputs } = useNodeCrud<LLMNodeType>(id, payload)
  const getVarInputs = getInputVars
  const isChatMode = useIsChatMode()

  const contexts = runInputData['#context#']
  const setContexts = useCallback((newContexts: string[]) => {
    setRunInputData?.({
      ...runInputDataRef.current,
      '#context#': newContexts,
    })
  }, [runInputDataRef, setRunInputData])

  const visionFiles = runInputData['#files#']
  const setVisionFiles = useCallback((newFiles: any[]) => {
    setRunInputData?.({
      ...runInputDataRef.current,
      '#files#': newFiles,
    })
  }, [runInputDataRef, setRunInputData])

  // model
  const model = inputs.model
  const modelMode = inputs.model?.mode
  const isChatModel = modelMode === 'chat'
  const {
    isVisionModel,
  } = useConfigVision(model, {
    payload: inputs.vision,
    onChange: noop,
  })

  const isShowVars = (() => {
    if (isChatModel)
      return (inputs.prompt_template as PromptItem[]).some(item => item.edition_type === EditionType.jinja2)

    return (inputs.prompt_template as PromptItem).edition_type === EditionType.jinja2
  })()

  const filterMemoryPromptVar = useCallback((varPayload: Var) => {
    return [VarType.arrayObject, VarType.array, VarType.number, VarType.string, VarType.secret, VarType.arrayString, VarType.arrayNumber, VarType.file, VarType.arrayFile].includes(varPayload.type)
  }, [])

  const {
    availableVars,
  } = useAvailableVarList(id, {
    onlyLeafNodeVar: false,
    filterVar: filterMemoryPromptVar,
  })

  const allVarStrArr = (() => {
    const arr = isChatModel ? (inputs.prompt_template as PromptItem[]).filter(item => item.edition_type !== EditionType.jinja2).map(item => item.text) : [(inputs.prompt_template as PromptItem).text]
    if (isChatMode && isChatModel && !!inputs.memory) {
      arr.push('{{#sys.query#}}')
      arr.push(inputs.memory.query_prompt_template)
    }

    return arr
  })()
  const varInputs = (() => {
    const vars = getVarInputs(allVarStrArr) || []
    if (isShowVars)
      return [...vars, ...(toVarInputs ? (toVarInputs(inputs.prompt_config?.jinja2_variables || [])) : [])]

    return vars
  })()

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

  const forms = (() => {
    const forms: FormProps[] = []

    if (varInputs.length > 0) {
      forms.push(
        {
          label: t(`${i18nPrefix}.singleRun.variable`)!,
          inputs: varInputs,
          values: inputVarValues,
          onChange: setInputVarValues,
        },
      )
    }

    if (inputs.context?.variable_selector && inputs.context?.variable_selector.length > 0) {
      forms.push(
        {
          label: t(`${i18nPrefix}.context`)!,
          inputs: [{
            label: '',
            variable: '#context#',
            type: InputVarType.contexts,
            required: false,
          }],
          values: { '#context#': contexts },
          onChange: keyValue => setContexts(keyValue['#context#']),
        },
      )
    }
    if (isVisionModel && payload.vision?.enabled && payload.vision?.configs?.variable_selector) {
      const currentVariable = findVariableWhenOnLLMVision(payload.vision.configs.variable_selector, availableVars)

      forms.push(
        {
          label: t(`${i18nPrefix}.vision`)!,
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
    const promptVars = varInputs.map((item) => {
      // Guard against null/undefined variable to prevent app crash
      if (!item.variable || typeof item.variable !== 'string')
        return []

      return item.variable.slice(1, -1).split('.')
    }).filter(arr => arr.length > 0)
    const contextVar = payload.context.variable_selector
    const vars = [...promptVars, contextVar]
    if (isVisionModel && payload.vision?.enabled && payload.vision?.configs?.variable_selector) {
      const visionVar = payload.vision.configs.variable_selector
      vars.push(visionVar)
    }
    return vars
  }

  const getDependentVar = (variable: string) => {
    if(variable === '#context#')
      return payload.context.variable_selector

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
