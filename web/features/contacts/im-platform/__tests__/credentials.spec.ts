import type { ContactImProvider } from '../types'
import {
  createCredentialsFor,
  emailSettingsFor,
  toDetailView,
  updateCredentialsFor,
  updateEmailSettingsFor,
} from '../credentials'
import { ContactImRepositoryErrorCode } from '../types'
import { channelSummary, emailDetail, imDetail } from './fixtures/channel-client'

const values = {
  appId: ' app-id ',
  clientId: ' client-id ',
  corpId: ' corp-id ',
  agentId: ' agent-id ',
  tenantId: ' tenant-id ',
  signingSecret: ' signing-secret ',
  botToken: ' bot-token ',
  appToken: ' app-token ',
  verificationToken: ' token ',
  encryptKey: ' encryption ',
  senderEmail: ' approvals@example.com ',
  senderName: ' Approvals ',
}

it.each<ContactImProvider>([
  'resend',
  'feishu',
  'lark',
  'slack',
  'ding_talk',
  'ms_teams',
  'we_com',
])('builds the generated %s credential shape and trims user input', (provider) => {
  const result = createCredentialsFor({ provider, secret: ' new-secret ', values })
  expect(result.provider).toBe(provider)
  const strings = Object.values(result).filter((value) => typeof value === 'string')
  strings.forEach((value) => expect(value).toBe(value.trim()))
  expect(result).toEqual(
    expect.objectContaining(
      provider === 'resend'
        ? { api_key: 'new-secret' }
        : provider === 'we_com'
          ? { secret: 'new-secret' }
          : provider === 'feishu' || provider === 'lark'
            ? { app_id: 'app-id', app_secret: 'new-secret' }
            : { client_secret: 'new-secret' },
    ),
  )
})

it.each<ContactImProvider>([
  'resend',
  'feishu',
  'lark',
  'slack',
  'ding_talk',
  'ms_teams',
  'we_com',
])('retains redacted %s credentials with the generated unchanged sentinel', (provider) => {
  const result = updateCredentialsFor({ provider, values: {} })
  for (const [key, value] of Object.entries(result))
    if (key !== 'provider') expect(value).toEqual({ type: 'unchanged' })
})

it('clears only explicitly selected optional credentials', () => {
  expect(
    updateCredentialsFor({ provider: 'feishu', values: {}, clearedFields: ['encryptKey'] }),
  ).toMatchObject({ encrypt_key: null, verification_token: { type: 'unchanged' } })
  expect(() =>
    updateCredentialsFor({ provider: 'feishu', values: {}, clearedFields: ['secret'] }),
  ).toThrow(ContactImRepositoryErrorCode.InvalidCommand)
})

it('requires fresh credentials on initial connection', () => {
  expect(() => createCredentialsFor({ provider: 'feishu', values: { appId: 'app-1' } })).toThrow(
    ContactImRepositoryErrorCode.RequiredFieldsMissing,
  )
})

it('preserves email settings independently from its saved secret', () => {
  expect(emailSettingsFor({ provider: 'resend', values })).toEqual({
    sender_email: 'approvals@example.com',
    sender_name: 'Approvals',
  })
  expect(updateEmailSettingsFor({ provider: 'resend', values: {} })).toEqual({
    sender_email: { type: 'unchanged' },
    sender_name: { type: 'unchanged' },
  })
})

it.each<ContactImProvider>(['feishu', 'lark', 'slack', 'ding_talk', 'ms_teams', 'we_com'])(
  'projects %s redaction metadata without ever putting saved secrets into form values',
  (provider) => {
    const summary = channelSummary({ provider })
    const result = toDetailView(imDetail(summary))
    expect(result.id).toBe(summary.id)
    expect(result.status).toBe(summary.status)
    expect(result.configuredFields).toContain('secret')
    expect(result.configuredValues).not.toHaveProperty('secret')
    expect(result.configuredValues).not.toHaveProperty('signingSecret')
  },
)

it('projects the actual email sender identity', () => {
  const result = toDetailView(emailDetail(channelSummary({ provider: 'resend', kind: 'email' })))
  expect(result.configuredValues).toEqual({
    senderEmail: 'sender@example.test',
    senderName: 'Approvals',
  })
  expect(result.secretConfigured).toBe(true)
})
