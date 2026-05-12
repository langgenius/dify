import type {
  CommonNodeType,
  InputVarType,
  ValueSelector,
} from '@/app/components/workflow/types'

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

export type FormInputItem = {
  type: InputVarType
  output_variable_name: string
  default: FormInputItemDefault
}
