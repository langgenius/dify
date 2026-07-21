import type { HumanInputSharedNodeType } from '../human-input/shared/types'
import type { CommonNodeType, ValueSelector } from '@/app/components/workflow/types'
import { BlockEnum } from '@/app/components/workflow/types'

export type ContactRecipient = {
  type: 'contact'
  contact_id: string
}

export type DynamicEmailRecipient = {
  type: 'dynamic_email'
  selector: ValueSelector
}

export type OnetimeEmailRecipient = {
  type: 'onetime_email'
  email: string
}

export type InitiatorRecipient = {
  type: 'initiator'
}

export type HumanInputV2Recipient =
  | ContactRecipient
  | DynamicEmailRecipient
  | OnetimeEmailRecipient
  | InitiatorRecipient

export const HUMAN_INPUT_V2_DEBUG_CHANNELS = [
  'email',
  'feishu',
  'slack',
  'ding_talk',
  'ms_teams',
  'we_com',
] as const

export type HumanInputV2DebugChannel = (typeof HUMAN_INPUT_V2_DEBUG_CHANNELS)[number]

export type HumanInputV2MessageTemplate = {
  subject: string
  body: string
}

export type HumanInputV2DebugMode = {
  enabled: boolean
  channels: HumanInputV2DebugChannel[]
}

export type HumanInputV2NodeType = HumanInputSharedNodeType & {
  type: BlockEnum.HumanInput
  version: '2'
  recipients_spec: HumanInputV2Recipient[]
  message_template: HumanInputV2MessageTemplate
  debug_mode: HumanInputV2DebugMode
}

export function isHumanInputV2NodeData(data: CommonNodeType): data is HumanInputV2NodeType {
  return data.type === BlockEnum.HumanInput && (data as { version?: unknown }).version === '2'
}

export function isHumanInputV2DebugChannel(value: string): value is HumanInputV2DebugChannel {
  return HUMAN_INPUT_V2_DEBUG_CHANNELS.includes(value as HumanInputV2DebugChannel)
}
