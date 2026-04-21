import type {
  CommonNodeType,
  ValueSelector,
} from '@/app/components/workflow/types'
import { InputVarType } from '@/app/components/workflow/types'

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

export type FormInputItemDefault = {
  selector: ValueSelector
  type: 'variable' | 'constant'
  value: string
}

type BaseFormInputItem = {
  output_variable_name: string
}

export type ParagraphFormInput = BaseFormInputItem & {
  type: InputVarType.paragraph
  default: FormInputItemDefault
}

export type SelectFormInput = BaseFormInputItem & {
  type: InputVarType.select
}

export type FileFormInput = BaseFormInputItem & {
  type: InputVarType.singleFile
}

export type FileListFormInput = BaseFormInputItem & {
  type: InputVarType.multiFiles
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
