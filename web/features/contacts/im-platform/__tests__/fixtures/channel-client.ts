import type {
  ChannelSummary,
  EmailChannelDetailResponse as EmailDetail,
  ImChannelDetailResponse as ImDetail,
} from '@dify/contracts/api/console/workspaces/types.gen'

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
