import type { CommonNodeType, Variable } from '@/app/components/workflow/types'

export type HumanInputNodeType = CommonNodeType & {
  delivery_methods: DeliveryMethod[]
  form_content: any
  user_actions: UserAction[]
  timeout: number
  timeout_unit: 'hour' | 'day'
  outputs: Variable[]
}

export enum DeliveryMethodType {
  WebApp = 'webapp',
  Email = 'email',
  Slack = 'slack',
}

export type Recipient = {
  type: 'member' | 'external'
  email?: string
  user_id?: string
}

export type EmailConfig = {
  recipients: Recipient[]
  subject: string
  body: string
}

export type DeliveryMethod = {
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
