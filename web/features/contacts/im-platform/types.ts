import type { ChannelSummary } from '@dify/contracts/api/console/workspaces/types.gen'
type ValueOf<T> = T[keyof T]
export const ContactImProvider = {
  DingTalk: 'ding_talk',
  Email: 'resend',
  Feishu: 'feishu',
  Lark: 'lark',
  MSTeams: 'ms_teams',
  WeCom: 'we_com',
  Slack: 'slack',
} as const
export type ContactImProvider = ChannelSummary['provider']
export const ContactImProviderField = {
  AppId: 'appId',
  CorpId: 'corpId',
  AgentId: 'agentId',
  SigningSecret: 'signingSecret',
  BotToken: 'botToken',
  AppToken: 'appToken',
  VerificationToken: 'verificationToken',
  EncryptKey: 'encryptKey',
  ClientId: 'clientId',
  SenderEmail: 'senderEmail',
  SenderName: 'senderName',
  Secret: 'secret',
  TenantId: 'tenantId',
} as const

export type ContactImProviderField = ValueOf<typeof ContactImProviderField>

export const ContactImRepositoryErrorCode = {
  ConfigurationUpdated: 'configuration_updated',
  InvalidCommand: 'invalid_command',
  MutationFailed: 'mutation_failed',
  NoPermission: 'no_permission',
  PageLoadFailed: 'page_load_failed',
  ReplacementRequired: 'replacement_required',
  RequiredFieldsMissing: 'required_fields_missing',
  SavedDetailsUnavailable: 'saved_details_unavailable',
  SyncRunNotFound: 'sync_run_not_found',
} as const

export type ContactImRepositoryErrorCode = ValueOf<typeof ContactImRepositoryErrorCode>

export class ContactImRepositoryError extends Error {
  code: ContactImRepositoryErrorCode
  statusDescription?: string

  constructor(code: ContactImRepositoryErrorCode, statusDescription?: string) {
    super(code)
    this.name = 'ContactImRepositoryError'
    this.code = code
    this.statusDescription = statusDescription
  }

  toJSON() {
    return {
      code: this.code,
      name: this.name,
    }
  }
}

export type ContactImProviderFieldDefinition = {
  field: ContactImProviderField
  required: boolean
  secret?: boolean
}
export type ContactImProviderDefinition = {
  displayName: string
  provider: ContactImProvider
  requiredFields: ContactImProviderFieldDefinition[]
}
export type ContactImIntegrationView = ChannelSummary & {
  configuredValues: Partial<Record<Exclude<ContactImProviderField, 'secret'>, string>>
  configuredFields: ContactImProviderField[]
  secretConfigured: boolean
}
export type SaveContactImCredentialsCommand = {
  channelId?: string
  expectedConfigVersion?: string
  provider: ContactImProvider
  replaceActiveProvider: boolean
  clearedFields?: ContactImProviderField[]
  secret?: string
  values: Partial<Record<Exclude<ContactImProviderField, 'secret'>, string>>
}

export type ContactImProviderCommand = {
  channelId?: string
  expectedConfigVersion?: string
  provider: ContactImProvider
}

export type TestContactImConnectionCommand = ContactImProviderCommand & {
  clearedFields?: ContactImProviderField[]
  secret?: string
  values: Partial<Record<Exclude<ContactImProviderField, 'secret'>, string>>
}
