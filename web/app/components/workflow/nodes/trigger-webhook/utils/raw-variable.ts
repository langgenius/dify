import { VarType, type Variable } from '@/app/components/workflow/types'

export const WEBHOOK_RAW_VARIABLE_NAME = '_webhook_raw'
export const WEBHOOK_RAW_VARIABLE_LABEL = 'raw'

export const createWebhookRawVariable = (): Variable => ({
  variable: WEBHOOK_RAW_VARIABLE_NAME,
  label: WEBHOOK_RAW_VARIABLE_LABEL,
  value_type: VarType.object,
  value_selector: [],
  required: true,
})

type WithVariables = {
  variables?: Variable[]
}

export const ensureWebhookRawVariable = <T extends WithVariables>(payload: T): void => {
  if (!payload.variables)
    payload.variables = []

  const hasRawVariable = payload.variables.some(variable => variable.variable === WEBHOOK_RAW_VARIABLE_NAME)
  if (!hasRawVariable)
    payload.variables.push(createWebhookRawVariable())
}
