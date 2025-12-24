import type { GeneratedFormInputItem } from '@/app/components/workflow/nodes/human-input/types'
import type { HumanInputFormData } from '@/types/workflow'

export type ExecutedAction = {
  id: string
  title: string
}

export type HumanInputContentProps = {
  formData: HumanInputFormData
  executedAction?: ExecutedAction
  showEmailTip?: boolean
  showDebugModeTip?: boolean
  showTimeout?: boolean
  timeout?: number
  timeoutUnit?: 'hour' | 'day'
  onSubmit?: (formID: string, data: any) => Promise<void>
}

export type HumanInputFormProps = {
  formData: HumanInputFormData
  showTimeout?: boolean
  timeout?: number
  timeoutUnit?: 'hour' | 'day'
  onSubmit?: (formID: string, data: any) => Promise<void>
}

export type ContentItemProps = {
  content: string
  formInputFields: GeneratedFormInputItem[]
  inputs: Record<string, string>
  resolvedPlaceholderValues?: Record<string, string>
  onInputChange: (name: string, value: any) => void
}
