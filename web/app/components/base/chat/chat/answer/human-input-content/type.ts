import type { HumanInputFieldValue } from './field-renderer'
import type { FormInputItem } from '@/app/components/workflow/nodes/human-input/types'
import type { HumanInputFilledFormData, HumanInputFormData } from '@/types/workflow'

export type ExecutedAction = {
  id: string
  title: string
}

export type UnsubmittedHumanInputContentProps = {
  formData: HumanInputFormData
  showEmailTip?: boolean
  isEmailDebugMode?: boolean
  showDebugModeTip?: boolean
  onSubmit?: (formToken: string, data: HumanInputFormSubmitData) => Promise<void>
}

export type SubmittedHumanInputContentProps = {
  formData: HumanInputFilledFormData
}

export type HumanInputFormProps = {
  formData: HumanInputFormData
  onSubmit?: (formToken: string, data: HumanInputFormSubmitData) => Promise<void>
}

export type HumanInputFormSubmitData = {
  inputs: Record<string, unknown>
  action: string
}

export type ContentItemProps = {
  content: string
  formInputFields: FormInputItem[]
  inputs: Record<string, HumanInputFieldValue>
  onInputChange: (name: string, value: HumanInputFieldValue) => void
}
