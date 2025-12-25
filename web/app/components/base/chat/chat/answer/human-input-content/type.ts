import type { FormInputItem } from '@/app/components/workflow/nodes/human-input/types'
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
  expirationTime?: number
  onSubmit?: (formID: string, data: any) => Promise<void>
}

export type HumanInputFormProps = {
  formData: HumanInputFormData
  showTimeout?: boolean
  expirationTime?: number
  onSubmit?: (formID: string, data: any) => Promise<void>
}

export type ContentItemProps = {
  content: string
  formInputFields: FormInputItem[]
  inputs: Record<string, string>
  resolvedPlaceholderValues?: Record<string, string>
  onInputChange: (name: string, value: any) => void
}
