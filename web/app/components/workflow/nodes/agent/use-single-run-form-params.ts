import type { RefObject } from 'react'
import type { InputVar, Variable } from '@/app/components/workflow/types'
import { useMemo } from 'react'
import useNodeCrud from '../_base/hooks/use-node-crud'
import type { AgentNodeType } from './types'
import { useTranslation } from 'react-i18next'
import type { Props as FormProps } from '@/app/components/workflow/nodes/_base/components/before-run-form/form'
import { useStrategyInfo } from './use-config'
import type { NodeTracing } from '@/types/workflow'
import formatTracing from '@/app/components/workflow/run/utils/format-log'

type Params = {
  id: string,
  payload: AgentNodeType,
  runInputData: Record<string, any>
  runInputDataRef: RefObject<Record<string, any>>
  getInputVars: (textList: string[]) => InputVar[]
  setRunInputData: (data: Record<string, any>) => void
  toVarInputs: (variables: Variable[]) => InputVar[]
  runResult: NodeTracing
}
const useSingleRunFormParams = ({
  id,
  payload,
  runInputData,
  getInputVars,
  setRunInputData,
  runResult,
}: Params) => {
  const { t } = useTranslation()
  const { inputs } = useNodeCrud<AgentNodeType>(id, payload)

  const formData = useMemo(() => {
    return Object.fromEntries(
      Object.entries(inputs.agent_parameters || {}).map(([key, value]) => {
        return [key, value.value]
      }),
    )
  }, [inputs.agent_parameters])

  const {
    strategy: currentStrategy,
  } = useStrategyInfo(
    inputs.agent_strategy_provider_name,
    inputs.agent_strategy_name,
  )

  const allVarStrArr = (() => {
    const arr = currentStrategy?.parameters.filter(item => item.type === 'string').map((item) => {
      return formData[item.name]
    }) || []
    return arr
  })()

  const varInputs = getInputVars?.(allVarStrArr)

  const forms = useMemo(() => {
    const forms: FormProps[] = []

    if (varInputs!.length > 0) {
      forms.push(
        {
          label: t('workflow.nodes.llm.singleRun.variable')!,
          inputs: varInputs!,
          values: runInputData,
          onChange: setRunInputData,
        },
      )
    }
    return forms
  }, [runInputData, setRunInputData, t, varInputs])

  const nodeInfo = useMemo(() => {
    if (!runResult)
      return
    return formatTracing([runResult], t)[0]
  }, [runResult, t])

  const getDependentVars = () => {
    return varInputs.map((item) => {
      // Guard against null/undefined variable to prevent app crash
      if (!item.variable || typeof item.variable !== 'string')
        return []

      return item.variable.slice(1, -1).split('.')
    }).filter(arr => arr.length > 0)
  }

  return {
    forms,
    nodeInfo,
    getDependentVars,
  }
}

export default useSingleRunFormParams
