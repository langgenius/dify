import type { Option } from '../../components/field/select'
import type { TransferMethod } from '@/types/app'

export const BaseFieldType = {
  textInput: 'text-input',
  paragraph: 'paragraph',
  numberInput: 'number-input',
  checkbox: 'checkbox',
  select: 'select',
  file: 'file',
  fileList: 'file-list',
} as const

export type BaseFieldType = (typeof BaseFieldType)[keyof typeof BaseFieldType]

export type ShowCondition = {
  variable: string
  value: any
}

export type NumberConfiguration = {
  max?: number
  min?: number
  unit?: string
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

type FileConfiguration = {
  allowedFileTypes: string[]
  allowedFileExtensions: string[]
  allowedFileUploadMethods: TransferMethod[]
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
} & NumberConfiguration &
  Partial<SelectConfiguration> &
  Partial<FileConfiguration>
