import type { DeepKeys, FieldListeners } from '@tanstack/react-form'
import type { NumberConfiguration, SelectConfiguration, ShowCondition } from '../base/types'

export enum InputFieldType {
  textInput = 'textInput',
  numberInput = 'numberInput',
  numberSlider = 'numberSlider',
  checkbox = 'checkbox',
  options = 'options',
  select = 'select',
  inputTypeSelect = 'inputTypeSelect',
  uploadMethod = 'uploadMethod',
  fileTypes = 'fileTypes',
}

export type InputTypeSelectConfiguration = {
  supportFile: boolean
}

export type NumberSliderConfiguration = {
  description: string
  max?: number
  min?: number
}

export type InputFieldConfiguration = {
  label: string
  variable: string // Variable name
  maxLength?: number // Max length for text input
  placeholder?: string
  required: boolean
  showOptional?: boolean // show optional label
  showConditions: ShowCondition[] // Show this field only when all conditions are met
  type: InputFieldType
  tooltip?: string // Tooltip for this field
  listeners?: FieldListeners<Record<string, any>, DeepKeys<Record<string, any>>> // Listener for this field
} & NumberConfiguration & Partial<InputTypeSelectConfiguration>
  & Partial<NumberSliderConfiguration>
  & Partial<SelectConfiguration>
