import type {
  FormInputItem as SharedFormInputItem,
  FormInputItemDefault as SharedFormInputItemDefault,
  HumanInputSharedNodeType as SharedHumanInputNodeType,
  ParagraphFormInput as SharedParagraphFormInput,
  UserAction as SharedUserAction,
  UserActionButtonType as SharedUserActionButtonType,
} from './shared/types'
import {
  createDefaultFormInputByType as createSharedDefaultFormInputByType,
  createDefaultParagraphFormInput as createSharedDefaultParagraphFormInput,
  isFileFormInput as isSharedFileFormInput,
  isFileListFormInput as isSharedFileListFormInput,
  isParagraphFormInput as isSharedParagraphFormInput,
  isSelectFormInput as isSharedSelectFormInput,
  UserActionButtonType as SharedUserActionButtonTypes,
} from './shared/types'

type HumanInputSharedNodeType = SharedHumanInputNodeType
export type UserActionButtonType = SharedUserActionButtonType
export type UserAction = SharedUserAction
export type StringDefault = SharedFormInputItemDefault
export type ParagraphFormInput = SharedParagraphFormInput
export type FormInputItem = SharedFormInputItem

export const UserActionButtonType = SharedUserActionButtonTypes
export const isParagraphFormInput = isSharedParagraphFormInput
export const isSelectFormInput = isSharedSelectFormInput
export const isFileFormInput = isSharedFileFormInput
export const isFileListFormInput = isSharedFileListFormInput
export const createDefaultParagraphFormInput = createSharedDefaultParagraphFormInput
export const createDefaultFormInputByType = createSharedDefaultFormInputByType

export type HumanInputNodeType = HumanInputSharedNodeType & {
  delivery_methods: DeliveryMethod[]
}

export const DeliveryMethodType = {
  WebApp: 'webapp',
  Email: 'email',
  Slack: 'slack',
  Teams: 'teams',
  Discord: 'discord',
} as const

export type DeliveryMethodType = (typeof DeliveryMethodType)[keyof typeof DeliveryMethodType]

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
