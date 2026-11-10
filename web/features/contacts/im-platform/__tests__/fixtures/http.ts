import type { ImSyncRun } from '@dify/contracts/api/console/workspaces/types.gen'
import { channelSummary, emailDetail, imDetail } from './channel-client'

export const channel = channelSummary({
  provider: 'feishu',
  display_identifier: 'saved-tenant',
  id: 'channel-1',
})
export const providers = {
  email_providers: [{ provider: 'resend' }],
  im_providers: [
    { provider: 'feishu' },
    { provider: 'lark' },
    { provider: 'slack' },
    { provider: 'ding_talk' },
    { provider: 'ms_teams' },
    { provider: 'we_com' },
  ],
}
export const syncRun = (overrides: Partial<ImSyncRun> = {}): ImSyncRun => ({
  id: 'run-1',
  channel_id: channel.id,
  channel_config_version: 1,
  provider: 'feishu',
  started_at: 1,
  finished_at: 2,
  status: 'succeeded',
  result_counts: { added: 0, not_matched: 0, failed: 0, removed: 0, skipped: 0 },
  ...overrides,
})
export const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } })
export function defaultResponse(request: Request) {
  const url = new URL(request.url)
  if (url.pathname.endsWith('/channel-providers')) return json(providers)
  if (url.pathname.endsWith('/channels')) return json({ channels: [channel] })
  if (url.pathname.endsWith('/channels/im/channel-1'))
    return json(request.method === 'GET' ? imDetail(channel) : { summary: channel })
  if (url.pathname.endsWith('/channels/email/channel-email'))
    return json(
      request.method === 'GET'
        ? emailDetail(channelSummary({ id: 'channel-email', kind: 'email', provider: 'resend' }))
        : { summary: channelSummary({ id: 'channel-email', kind: 'email', provider: 'resend' }) },
    )
  if (url.pathname.endsWith('/im-sync-runs/latest')) return json({ run: syncRun() })
  if (url.pathname.endsWith('/im-sync-runs/latest/results'))
    return json({
      data: [],
      total: 0,
      limit: Number(url.searchParams.get('limit')),
      page: Number(url.searchParams.get('page')),
    })
  throw new Error(`Unexpected request: ${request.method} ${request.url}`)
}
