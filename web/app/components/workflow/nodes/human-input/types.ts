import type {
  CommonNodeType,
  UploadFileSetting,
  ValueSelector,
} from '@/app/components/workflow/types'
import {
  InputVarType,
  SupportUploadFileTypes,
} from '@/app/components/workflow/types'
import { TransferMethod } from '@/types/app'

export type HumanInputNodeType = CommonNodeType & {
  delivery_methods: DeliveryMethod[]
  form_content: string
  inputs: FormInputItem[]
  user_actions: UserAction[]
  timeout: number
  timeout_unit: 'hour' | 'day'
}

export enum DeliveryMethodType {
  WebApp = 'webapp',
  Email = 'email',
  Slack = 'slack',
  Teams = 'teams',
  Discord = 'discord',
}

export type Recipient = {
  type: 'member' | 'external'
  email?: string
  user_id?: string
}

export type RecipientData = {
  whole_workspace: boolean
  items: Recipient[]
}

export type EmailConfig = {
  recipients: RecipientData
  subject: string
  body: string
  debug_mode: boolean
}

export type DeliveryMethod = {
  id: string
  type: DeliveryMethodType
  enabled: boolean
  config?: EmailConfig
}

export enum UserActionButtonType {
  Primary = 'primary',
  Default = 'default',
  Accent = 'accent',
  Ghost = 'ghost',
}

export type UserAction = {
  id: string
  title: string
  button_style: UserActionButtonType
}

export type StringDefault = {
  selector: ValueSelector
  type: 'variable' | 'constant'
  value: string
}

export type StringListSource = {
  selector: ValueSelector
  type: 'variable' | 'constant'
  value: string[]
}

// Preserve the old export during the transition to the new schema names.
export type FormInputItemDefault = StringDefault

type BaseFormInputItem = {
  output_variable_name: string
}

export type ParagraphFormInput = BaseFormInputItem & {
  type: InputVarType.paragraph
  default: StringDefault
}

export type SelectFormInput = BaseFormInputItem & {
  type: InputVarType.select
  option_source: StringListSource
}

type SharedFileFormInput = Pick<
  UploadFileSetting,
  'allowed_file_extensions' | 'allowed_file_types' | 'allowed_file_upload_methods'
>

export type FileFormInput = BaseFormInputItem & SharedFileFormInput & {
  type: InputVarType.singleFile
}

export type FileListFormInput = BaseFormInputItem & SharedFileFormInput & {
  type: InputVarType.multiFiles
  number_limits?: UploadFileSetting['number_limits']
}

export type FormInputItem
  = | ParagraphFormInput
    | SelectFormInput
    | FileFormInput
    | FileListFormInput

export const isParagraphFormInput = (
  input: FormInputItem,
): input is ParagraphFormInput => {
  return input.type === InputVarType.paragraph
}

export const isSelectFormInput = (
  input: FormInputItem,
): input is SelectFormInput => {
  return input.type === InputVarType.select
}

export const isFileFormInput = (
  input: FormInputItem,
): input is FileFormInput => {
  return input.type === InputVarType.singleFile
}

export const isFileListFormInput = (
  input: FormInputItem,
): input is FileListFormInput => {
  return input.type === InputVarType.multiFiles
}

export const isFileLikeFormInput = (
  input: FormInputItem,
): input is FileFormInput | FileListFormInput => {
  return input.type === InputVarType.singleFile || input.type === InputVarType.multiFiles
}

export const supportsDefaultValue = (
  input: FormInputItem,
): input is ParagraphFormInput => {
  return isParagraphFormInput(input)
}

export const createDefaultParagraphFormInput = (
  output_variable_name = '',
): ParagraphFormInput => ({
  type: InputVarType.paragraph,
  output_variable_name,
  default: {
    type: 'constant',
    selector: [],
    value: '',
  },
})

export const createDefaultSelectFormInput = (
  output_variable_name = '',
): SelectFormInput => ({
  type: InputVarType.select,
  output_variable_name,
  option_source: {
    type: 'constant',
    selector: [],
    value: [],
  },
})

export const createDefaultFileFormInput = (
  output_variable_name = '',
): FileFormInput => ({
  type: InputVarType.singleFile,
  output_variable_name,
  allowed_file_extensions: [],
  allowed_file_types: [SupportUploadFileTypes.image],
  allowed_file_upload_methods: [TransferMethod.local_file, TransferMethod.remote_url],
})

export const createDefaultFileListFormInput = (
  output_variable_name = '',
): FileListFormInput => ({
  type: InputVarType.multiFiles,
  output_variable_name,
  allowed_file_extensions: [],
  allowed_file_types: [SupportUploadFileTypes.image],
  allowed_file_upload_methods: [TransferMethod.local_file, TransferMethod.remote_url],
  number_limits: 5,
})

export const createDefaultFormInputByType = (
  type: FormInputItem['type'],
  output_variable_name = '',
): FormInputItem => {
  switch (type) {
    case InputVarType.select:
      return createDefaultSelectFormInput(output_variable_name)
    case InputVarType.singleFile:
      return createDefaultFileFormInput(output_variable_name)
    case InputVarType.multiFiles:
      return createDefaultFileListFormInput(output_variable_name)
    case InputVarType.paragraph:
    default:
      return createDefaultParagraphFormInput(output_variable_name)
  }
}
