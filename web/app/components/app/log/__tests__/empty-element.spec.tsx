import type { AppMode } from '@dify/contracts/api/console/apps/types.gen'
import { screen } from '@testing-library/react'
import { renderWithConsoleQuery as render } from '@/test/console/query-data'
import { createAppDetailFixture, createAppSiteFixture } from '@/test/fixtures/app'
import { AppACLPermission } from '@/utils/permission'
import EmptyElement from '../empty-element'

vi.mock('react-i18next', async () => {
  const { withSelectorKey, withSelectorKeyProps } = await import('@/test/i18n-mock')
  return {
    useTranslation: () => ({
      t: withSelectorKey((key: string) => key),
    }),
    Trans: withSelectorKeyProps(
      ({
        i18nKey,
        components,
      }: {
        i18nKey: string
        components: Record<string, React.ReactNode>
      }) => (
        <span>
          {i18nKey}
          {components.shareLink}
          {components.testLink}
        </span>
      ),
    ),
  }
})

vi.mock('@/utils/var', () => ({
  basePath: '/base',
}))

describe('EmptyElement', () => {
  const createMockAppDetail = (mode: AppMode) =>
    createAppDetailFixture({
      id: 'test-app-id',
      permission_keys: [AppACLPermission.Monitor],
      name: 'Test App',
      description: 'Test description',
      mode,
      icon_type: 'emoji',
      icon: 'test-icon',
      icon_background: '#ffffff',
      enable_site: true,
      enable_api: true,
      created_at: Date.now(),
      site: createAppSiteFixture({
        access_token: 'test-token',
        app_base_url: 'https://app.example.com',
      }),
    })

  it.each([null, createAppSiteFixture({ access_token: null })])(
    'keeps the editor link without offering an unavailable site link',
    (site) => {
      render(<EmptyElement appDetail={{ ...createMockAppDetail('chat'), site }} />)

      const links = screen.getAllByRole('link')
      expect(links).toHaveLength(1)
      expect(links[0]).toHaveAttribute('href', '/app/test-app-id/overview')
    },
  )

  it.each<{ mode: AppMode; path: string }>([
    { mode: 'chat', path: 'chat' },
    { mode: 'advanced-chat', path: 'chat' },
    { mode: 'agent-chat', path: 'chat' },
    { mode: 'completion', path: 'completion' },
    { mode: 'workflow', path: 'workflow' },
  ])('links to the $mode site and an accessible console destination', ({ mode, path }) => {
    render(<EmptyElement appDetail={createMockAppDetail(mode)} />)
    const [shareLink, consoleLink] = screen.getAllByRole('link')
    expect(shareLink).toHaveAttribute('href', `https://app.example.com/base/${path}/test-token`)
    expect(shareLink).toHaveAttribute('target', '_blank')
    expect(shareLink).toHaveAttribute('rel', 'noopener noreferrer')
    expect(consoleLink).toHaveAttribute('href', '/app/test-app-id/overview')
  })
})
