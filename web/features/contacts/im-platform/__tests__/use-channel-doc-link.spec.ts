import { useLocale } from '#i18n'
import { renderHookWithConsoleQuery } from '@/test/console/query-data'
import { useChannelDocLink } from '../use-channel-doc-link'

// boundary: select the user's locale while keeping documentation routing and deployment state real.
vi.mock('#i18n', () => ({
  useLocale: vi.fn(() => 'en-US'),
}))

it.each([
  [
    'CLOUD',
    'en-US',
    '/use-dify/workspace/channels/overview',
    'https://docs.dify.ai/en/cloud/use-dify/workspace/channels/overview',
  ],
  [
    'CLOUD',
    'zh-Hans',
    '/use-dify/workspace/channels/email',
    'https://docs.dify.ai/zh/cloud/use-dify/workspace/channels/email',
  ],
  [
    'COMMUNITY',
    'ja-JP',
    '/use-dify/workspace/channels/slack',
    'https://docs.dify.ai/ja/self-host/use-dify/workspace/channels/slack',
  ],
  [
    'ENTERPRISE',
    'zh-Hans',
    '/use-dify/workspace/channels/feishu-lark',
    'https://enterprise-docs.dify.ai/zh/use/workspace/channels/feishu-lark',
  ],
] as const)('routes %s channel docs in %s', (deploymentEdition, locale, path, expectedUrl) => {
  vi.mocked(useLocale).mockReturnValue(locale)
  const { result } = renderHookWithConsoleQuery(() => useChannelDocLink(), {
    systemFeatures: { deployment_edition: deploymentEdition },
  })

  expect(result.current(path)).toBe(expectedUrl)
})
