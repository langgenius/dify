import type { Option } from '../../../select/pure'
import type { CustomActionsProps } from '../../components/form/actions'
import type { TransferMethod } from '@/types/app'

export enum BaseFieldType {
  textInput = 'text-input',
  paragraph = 'paragraph',
  numberInput = 'number-input',
  checkbox = 'checkbox',
  select = 'select',
  file = 'file',
  fileList = 'file-list',
}

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

export type FileConfiguration = {
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
} & NumberConfiguration
& Partial<SelectConfiguration>
& Partial<FileConfiguration>

export type BaseFormProps = {
  initialData?: Record<string, any>
  configurations: BaseConfiguration[]
  CustomActions?: (props: CustomActionsProps) => React.ReactNode
  onSubmit: (value: Record<string, any>) => void
}
