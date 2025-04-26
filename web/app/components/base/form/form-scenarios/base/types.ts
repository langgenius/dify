import type { DeepKeys } from '@tanstack/react-form'
import type { FormType } from '../..'
import type { Option } from '../../../select/pure'

export enum BaseVarType {
  textInput = 'textInput',
  numberInput = 'numberInput',
  checkbox = 'checkbox',
  select = 'select',
}

export type ShowCondition<T> = {
  variable: DeepKeys<T>
  value: any
}

export type NumberConfiguration = {
  max?: number
  min?: number
}

export type SelectConfiguration = {
  options?: Option[] // Options for select field
}

export type BaseConfiguration<T> = {
  label: string
  variable: DeepKeys<T> // Variable name
  maxLength?: number // Max length for text input
  placeholder?: string
  required: boolean
  showOptional?: boolean // show optional label
  showConditions: ShowCondition<T>[] // Show this field only when all conditions are met
  type: BaseVarType
  tooltip?: string // Tooltip for this field
} & NumberConfiguration & SelectConfiguration

export type BaseFormProps<T> = {
  initialData?: T
  configurations: BaseConfiguration<T>[]
  CustomActions?: (form: FormType) => React.ReactNode
  onSubmit: (value: T) => void
}
