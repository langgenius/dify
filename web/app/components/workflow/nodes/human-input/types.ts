import type { CommonNodeType, Variable } from '@/app/components/workflow/types'

export type HumanInputNodeType = CommonNodeType & {
  delivery_methods: DeliveryMethod[]
  form_content: any
  user_actions: UserAction[]
  timeout: Timeout
  outputs: Variable[]
}

export type Timeout = {
  value: number
  unit: 'hours' | 'days'
}

export enum DeliveryMethodType {
  WebApp = 'webapp',
  Email = 'email',
  Slack = 'slack',
}

export type DeliveryMethod = {
  type: DeliveryMethodType
  enabled: boolean
  config?: Record<string, any>
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
