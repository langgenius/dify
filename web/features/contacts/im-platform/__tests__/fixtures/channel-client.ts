import type { ChannelSummary } from '@dify/contracts/api/console/workspaces/types.gen'
import type { createContactImApiRepository } from '../../repository'

type ChannelApiClient = NonNullable<Parameters<typeof createContactImApiRepository>[1]>
type EmailDetail = Awaited<ReturnType<ChannelApiClient['channels']['email']['byChannelId']['get']>>
type ImDetail = Awaited<ReturnType<ChannelApiClient['channels']['im']['byChannelId']['get']>>

export function createChannelClient() {
  const client = {
    channelProviders: { get: vi.fn<ChannelApiClient['channelProviders']['get']>() },
    channels: {
      get: vi.fn<ChannelApiClient['channels']['get']>(),
      email: {
        post: vi.fn<ChannelApiClient['channels']['email']['post']>(),
        test: { post: vi.fn<ChannelApiClient['channels']['email']['test']['post']>() },
        byChannelId: {
          get: vi.fn<ChannelApiClient['channels']['email']['byChannelId']['get']>(),
          put: vi.fn<ChannelApiClient['channels']['email']['byChannelId']['put']>(),
          delete: vi.fn<ChannelApiClient['channels']['email']['byChannelId']['delete']>(),
          test: {
            post: vi.fn<ChannelApiClient['channels']['email']['byChannelId']['test']['post']>(),
          },
        },
      },
      im: {
        post: vi.fn<ChannelApiClient['channels']['im']['post']>(),
        test: { post: vi.fn<ChannelApiClient['channels']['im']['test']['post']>() },
        byChannelId: {
          get: vi.fn<ChannelApiClient['channels']['im']['byChannelId']['get']>(),
          put: vi.fn<ChannelApiClient['channels']['im']['byChannelId']['put']>(),
          delete: vi.fn<ChannelApiClient['channels']['im']['byChannelId']['delete']>(),
          test: {
            post: vi.fn<ChannelApiClient['channels']['im']['byChannelId']['test']['post']>(),
          },
          replacement: {
            post: vi.fn<ChannelApiClient['channels']['im']['byChannelId']['replacement']['post']>(),
          },
        },
      },
    },
  } satisfies ChannelApiClient
  client.channels.email.byChannelId.get.mockImplementation(async ({ params }) =>
    emailDetail(channelSummary({ id: params.channel_id, kind: 'email', provider: 'resend' })),
  )
  client.channels.im.byChannelId.get.mockImplementation(async ({ params }) =>
    imDetail(channelSummary({ id: params.channel_id })),
  )
  return client
}

export function channelSummary(overrides: Partial<ChannelSummary> = {}): ChannelSummary {
  return {
    id: 'channel-1',
    kind: 'im',
    provider: 'slack',
    config_version: 'snapshot-version',
    created_at: 1,
    updated_at: 2,
    status: 'connected',
    status_description: 'Connected',
    display_identifier: 'App display name',
    webhook_url: 'https://example.test/callback',
    ...overrides,
  }
}

export function emailDetail(summary: ChannelSummary): EmailDetail {
  return {
    summary,
    sender_email: 'sender@example.test',
    sender_name: 'Approvals',
    credentials: { provider: 'resend', api_key: { type: 'redacted' } },
  }
}

export function imDetail(summary: ChannelSummary): ImDetail {
  const redacted = { type: 'redacted' } as const
  switch (summary.provider) {
    case 'feishu':
    case 'lark':
      return {
        summary,
        credentials: {
          provider: summary.provider,
          app_id: 'app-1',
          app_secret: redacted,
          verification_token: redacted,
          encrypt_key: null,
        },
      }
    case 'slack':
      return {
        summary,
        credentials: {
          provider: 'slack',
          client_id: 'client-1',
          client_secret: redacted,
          signing_secret: redacted,
          bot_token: redacted,
          app_token: null,
        },
      }
    case 'ding_talk':
      return {
        summary,
        credentials: {
          provider: 'ding_talk',
          corp_id: 'corp-1',
          client_id: 'client-1',
          client_secret: redacted,
        },
      }
    case 'ms_teams':
      return {
        summary,
        credentials: {
          provider: 'ms_teams',
          tenant_id: 'tenant-1',
          client_id: 'client-1',
          client_secret: redacted,
        },
      }
    case 'we_com':
      return {
        summary,
        credentials: {
          provider: 'we_com',
          corp_id: 'corp-1',
          agent_id: 'agent-1',
          secret: redacted,
        },
      }
    case 'resend':
      throw new Error('Expected an IM provider')
  }
}
