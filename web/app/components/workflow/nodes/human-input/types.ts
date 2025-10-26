import type { CommonNodeType, InputVarType, ValueSelector, Variable } from '@/app/components/workflow/types'

export type HumanInputNodeType = CommonNodeType & {
  delivery_methods: DeliveryMethod[]
  form_content: string
  inputs: FormInputItem[]
  user_actions: UserAction[]
  timeout: number
  timeout_unit: 'hour' | 'day'
  outputs: Variable[]
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
  debug: boolean
}

export type DeliveryMethod = {
  type: DeliveryMethodType
  enabled: boolean
  config?: EmailConfig
}

export type FormInputItemPlaceholder = {
  type: 'variable' | 'const',
  selector: ValueSelector
  value: string
}

export type FormInputItem = {
  type: InputVarType
  output_variable_name: string
  // only text-input and paragraph support placeholder
  placeholder?: FormInputItemPlaceholder
  options?: any[]
  max_length?: number
  allowed_file_extensions?: string[]
  allowed_file_types?: string[]
  allowed_file_upload_methods?: string[]
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

export type GeneratedFormInputItem = {
  type: InputVarType
  output_variable_name: string
  // only text-input and paragraph support placeholder
  placeholder?: string
  options: any[]
  max_length: number
  allowed_file_extensions?: string[]
  allowed_file_types?: string[]
  allowed_file_upload_methods?: string[]
}
