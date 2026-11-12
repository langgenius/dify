import type { CommonNodeType, InputVar } from '@/app/components/workflow/types'
import { isExternalAgentWorkflowPreviewData } from './types'

export function getExternalAgentSingleRunFormParams<
  Params extends {
    payload: CommonNodeType
    getInputVars: (texts: string[]) => InputVar[]
    runInputData: Record<string, unknown>
    setRunInputData: (value: Record<string, unknown>) => void
  },
>({ payload, getInputVars, runInputData, setRunInputData }: Params) {
  const inputs = isExternalAgentWorkflowPreviewData(payload)
    ? getInputVars([payload.agent_task ?? ''])
    : []
  return {
    forms: inputs.length ? [{ inputs, values: runInputData, onChange: setRunInputData }] : [],
    getDependentVars: () => inputs.map((input) => input.variable.slice(1, -1).split('.')),
  }
}
