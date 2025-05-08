import type { FormType } from '../..'
import type { Option } from '../../../select/pure'

export enum BaseFieldType {
  textInput = 'textInput',
  numberInput = 'numberInput',
  checkbox = 'checkbox',
  select = 'select',
}

export type ShowCondition = {
  variable: string
  value: any
}

export type NumberConfiguration = {
  max?: number
  min?: number
}

export type SelectConfiguration = {
  options: Option[] // Options for select field
  popupProps?: {
    wrapperClassName?: string
    className?: string
    itemClassName?: string
    title?: string
  }
}

export type BaseConfiguration = {
  label: string
  variable: string // Variable name
  maxLength?: number // Max length for text input
  placeholder?: string
  required: boolean
  showOptional?: boolean // show optional label
  showConditions: ShowCondition[] // Show this field only when all conditions are met
  type: BaseFieldType
  tooltip?: string // Tooltip for this field
} & NumberConfiguration & Partial<SelectConfiguration>

export type BaseFormProps = {
  initialData?: Record<string, any>
  configurations: BaseConfiguration[]
  CustomActions?: (form: FormType) => React.ReactNode
  onSubmit: (value: Record<string, any>) => void
}
