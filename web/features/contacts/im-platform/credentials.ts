import type {
  EmailChannelDetailResponse,
  EmailProviderCredentialsUpdateInputWritable,
  EmailProviderCredentialsWritable,
  ImChannelDetailResponse,
  ImProviderCredentialsInputWritable,
  ImProviderCredentialsUpdateInputWritable,
  UnchangedInput,
} from '@dify/contracts/api/console/workspaces/types.gen'
import type {
  ContactImIntegrationView,
  ContactImProvider,
  ContactImProviderField,
  ContactImProviderFieldDefinition,
  TestContactImConnectionCommand,
} from './types'
import { ContactImRepositoryError, ContactImRepositoryErrorCode } from './types'

export const providerMetadata: Record<
  ContactImProvider,
  { name: string; fields: ContactImProviderFieldDefinition[] }
> = {
  resend: {
    name: 'Email',
    fields: [
      { field: 'senderEmail', required: true },
      { field: 'senderName', required: true },
      { field: 'secret', required: true, secret: true },
    ],
  },
  feishu: {
    name: 'Feishu',
    fields: [
      { field: 'appId', required: true },
      { field: 'secret', required: true, secret: true },
      { field: 'verificationToken', required: false, secret: true },
      { field: 'encryptKey', required: false, secret: true },
    ],
  },
  lark: {
    name: 'Lark',
    fields: [
      { field: 'appId', required: true },
      { field: 'secret', required: true, secret: true },
      { field: 'verificationToken', required: false, secret: true },
      { field: 'encryptKey', required: false, secret: true },
    ],
  },
  slack: {
    name: 'Slack',
    fields: [
      { field: 'clientId', required: true },
      { field: 'secret', required: true, secret: true },
      { field: 'signingSecret', required: true, secret: true },
      { field: 'botToken', required: true, secret: true },
      { field: 'appToken', required: false, secret: true },
    ],
  },
  ding_talk: {
    name: 'DingTalk',
    fields: [
      { field: 'corpId', required: true },
      { field: 'clientId', required: true },
      { field: 'secret', required: true, secret: true },
    ],
  },
  ms_teams: {
    name: 'Microsoft Teams',
    fields: [
      { field: 'tenantId', required: true },
      { field: 'clientId', required: true },
      { field: 'secret', required: true, secret: true },
    ],
  },
  we_com: {
    name: 'WeCom',
    fields: [
      { field: 'corpId', required: true },
      { field: 'agentId', required: true },
      { field: 'secret', required: true, secret: true },
    ],
  },
}

export function emailSettingsFor(command: TestContactImConnectionCommand) {
  const sender_email = command.values.senderEmail?.trim()
  const sender_name = command.values.senderName?.trim()
  if (!sender_email || !sender_name)
    throw new ContactImRepositoryError(ContactImRepositoryErrorCode.RequiredFieldsMissing)
  return { sender_email, sender_name }
}

export function updateEmailSettingsFor(command: TestContactImConnectionCommand) {
  const unchanged: UnchangedInput = { type: 'unchanged' }
  return {
    sender_email: command.values.senderEmail?.trim() || unchanged,
    sender_name: command.values.senderName?.trim() || unchanged,
  }
}

function validateClearedFields(command: TestContactImConnectionCommand) {
  for (const field of command.clearedFields ?? []) {
    const definition = providerMetadata[command.provider].fields.find(
      (item) => item.field === field,
    )
    if (!definition || definition.required)
      throw new ContactImRepositoryError(ContactImRepositoryErrorCode.InvalidCommand)
  }
}

export function createCredentialsFor(command: TestContactImConnectionCommand) {
  validateClearedFields(command)
  const required = (field: ContactImProviderField) => {
    const value = (field === 'secret' ? command.secret : command.values[field])?.trim()
    if (!value)
      throw new ContactImRepositoryError(ContactImRepositoryErrorCode.RequiredFieldsMissing)
    return value
  }
  const optional = (field: Exclude<ContactImProviderField, 'secret'>) =>
    command.clearedFields?.includes(field) ? null : command.values[field]?.trim() || null
  switch (command.provider) {
    case 'resend':
      return {
        provider: 'resend',
        api_key: required('secret'),
      } satisfies EmailProviderCredentialsWritable
    case 'feishu':
    case 'lark':
      return {
        provider: command.provider,
        app_id: required('appId'),
        app_secret: required('secret'),
        encrypt_key: optional('encryptKey'),
        verification_token: optional('verificationToken'),
      } satisfies ImProviderCredentialsInputWritable
    case 'slack':
      return {
        provider: 'slack',
        client_id: required('clientId'),
        client_secret: required('secret'),
        signing_secret: required('signingSecret'),
        bot_token: required('botToken'),
        app_token: optional('appToken'),
      } satisfies ImProviderCredentialsInputWritable
    case 'ding_talk':
      return {
        provider: 'ding_talk',
        corp_id: required('corpId'),
        client_id: required('clientId'),
        client_secret: required('secret'),
      } satisfies ImProviderCredentialsInputWritable
    case 'ms_teams':
      return {
        provider: 'ms_teams',
        tenant_id: required('tenantId'),
        client_id: required('clientId'),
        client_secret: required('secret'),
      } satisfies ImProviderCredentialsInputWritable
    case 'we_com':
      return {
        provider: 'we_com',
        corp_id: required('corpId'),
        agent_id: required('agentId'),
        secret: required('secret'),
      } satisfies ImProviderCredentialsInputWritable
  }
}

export function updateCredentialsFor(
  command: TestContactImConnectionCommand,
): EmailProviderCredentialsUpdateInputWritable | ImProviderCredentialsUpdateInputWritable {
  validateClearedFields(command)
  const unchanged: UnchangedInput = { type: 'unchanged' }
  const value = (field: ContactImProviderField) =>
    (field === 'secret' ? command.secret : command.values[field])?.trim() || unchanged
  const optional = (field: Exclude<ContactImProviderField, 'secret'>) =>
    command.clearedFields?.includes(field) ? null : value(field)

  switch (command.provider) {
    case 'resend':
      return {
        provider: 'resend',
        api_key: value('secret'),
      }
    case 'feishu':
    case 'lark':
      return {
        provider: command.provider,
        app_id: value('appId'),
        app_secret: value('secret'),
        encrypt_key: optional('encryptKey'),
        verification_token: optional('verificationToken'),
      }
    case 'slack':
      return {
        provider: 'slack',
        client_id: value('clientId'),
        client_secret: value('secret'),
        signing_secret: value('signingSecret'),
        bot_token: value('botToken'),
        app_token: optional('appToken'),
      }
    case 'ding_talk':
      return {
        provider: 'ding_talk',
        corp_id: value('corpId'),
        client_id: value('clientId'),
        client_secret: value('secret'),
      }
    case 'ms_teams':
      return {
        provider: 'ms_teams',
        tenant_id: value('tenantId'),
        client_id: value('clientId'),
        client_secret: value('secret'),
      }
    case 'we_com':
      return {
        provider: 'we_com',
        corp_id: value('corpId'),
        agent_id: value('agentId'),
        secret: value('secret'),
      }
  }
}

export const toDetailView = (
  detail: EmailChannelDetailResponse | ImChannelDetailResponse,
): ContactImIntegrationView => {
  const integration = detail.summary
  const configuredFields: ContactImProviderField[] = []
  const configuredValues: ContactImIntegrationView['configuredValues'] = {}
  const configured = (field: ContactImProviderField, present = true) => {
    if (present) configuredFields.push(field)
  }
  const plain = (field: Exclude<ContactImProviderField, 'secret'>, value: string) => {
    configuredValues[field] = value
    configured(field, Boolean(value))
  }
  if ('sender_email' in detail) {
    plain('senderEmail', detail.sender_email)
    plain('senderName', detail.sender_name)
    configured('secret', Boolean(detail.credentials.api_key))
  } else {
    const credentials = detail.credentials
    switch (credentials.provider) {
      case 'feishu':
      case 'lark':
        plain('appId', credentials.app_id)
        configured('secret', Boolean(credentials.app_secret))
        configured('verificationToken', credentials.verification_token !== null)
        configured('encryptKey', credentials.encrypt_key !== null)
        break
      case 'slack':
        plain('clientId', credentials.client_id)
        configured('secret', Boolean(credentials.client_secret))
        configured('signingSecret', Boolean(credentials.signing_secret))
        configured('botToken', Boolean(credentials.bot_token))
        configured('appToken', credentials.app_token !== null)
        break
      case 'ding_talk':
        plain('corpId', credentials.corp_id)
        plain('clientId', credentials.client_id)
        configured('secret', Boolean(credentials.client_secret))
        break
      case 'ms_teams':
        plain('tenantId', credentials.tenant_id)
        plain('clientId', credentials.client_id)
        configured('secret', Boolean(credentials.client_secret))
        break
      case 'we_com':
        plain('corpId', credentials.corp_id)
        plain('agentId', credentials.agent_id)
        configured('secret', Boolean(credentials.secret))
        break
    }
  }
  return {
    ...integration,
    configuredFields,
    configuredValues,
    secretConfigured: configuredFields.includes('secret'),
  }
}
