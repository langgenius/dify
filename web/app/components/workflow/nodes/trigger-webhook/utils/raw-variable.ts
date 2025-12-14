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
