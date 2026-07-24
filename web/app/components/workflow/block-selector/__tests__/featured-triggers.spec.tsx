import type { TriggerWithProvider } from '../types'
import type { Plugin } from '@/app/components/plugins/types'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PluginCategoryEnum, SupportedCreationMethods } from '@/app/components/plugins/types'
import { CollectionType } from '@/app/components/tools/types'
import useTheme from '@/hooks/use-theme'
import { Theme } from '@/types/app'
import { BlockEnum } from '../../types'
import FeaturedTriggers from '../featured-triggers'

vi.mock('@/hooks/use-theme', () => ({
  default: vi.fn(),
}))

vi.mock('@/app/components/workflow/block-selector/marketplace-plugin/action', () => ({
  default: () => <button type="button" aria-label="common.operation.more" />,
}))

vi.mock('@/app/components/plugins/install-plugin/install-from-marketplace', () => ({
  default: () => <div data-testid="install-from-marketplace" />,
}))

vi.mock(
  '@/app/components/plugins/install-plugin/hooks/use-workspace-plugin-install-permission',
  () => ({
    default: () => ({ canInstallPlugin: true, currentDifyVersion: '1.0.0' }),
  }),
)

vi.mock('@/utils/var', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/utils/var')>()
  return {
    ...actual,
    getMarketplaceUrl: (path = '') => `https://marketplace.test${path}`,
  }
})

const mockUseTheme = vi.mocked(useTheme)

const createPlugin = (overrides: Partial<Plugin> = {}): Plugin => ({
  type: 'trigger',
  org: 'org',
  author: 'author',
  name: 'trigger-plugin',
  plugin_id: 'plugin-1',
  version: '1.0.0',
  latest_version: '1.0.0',
  latest_package_identifier: 'plugin-1@1.0.0',
  icon: 'icon',
  verified: true,
  label: { en_US: 'Plugin One', zh_Hans: '插件一' },
  brief: { en_US: 'Brief', zh_Hans: '简介' },
  description: { en_US: 'Plugin description', zh_Hans: '插件描述' },
  introduction: 'Intro',
  repository: 'https://example.com',
  category: PluginCategoryEnum.trigger,
  install_count: 12,
  endpoint: { settings: [] },
  tags: [{ name: 'tag' }],
  badges: [],
  verification: { authorized_category: 'community' },
  from: 'marketplace',
  ...overrides,
})

const createTriggerProvider = (
  overrides: Partial<TriggerWithProvider> = {},
): TriggerWithProvider => ({
  id: 'provider-1',
  name: 'provider-one',
  author: 'Provider Author',
  description: { en_US: 'desc', zh_Hans: '描述' },
  icon: 'icon',
  icon_dark: 'icon-dark',
  label: { en_US: 'Provider One', zh_Hans: '提供商一' },
  type: CollectionType.trigger,
  team_credentials: {},
  is_team_authorization: false,
  allow_delete: false,
  labels: [],
  plugin_id: 'plugin-1',
  plugin_unique_identifier: 'plugin-1@1.0.0',
  meta: { version: '1.0.0' },
  credentials_schema: [],
  subscription_constructor: null,
  subscription_schema: [],
  supported_creation_methods: [SupportedCreationMethods.MANUAL],
  events: [
    {
      name: 'created',
      author: 'Provider Author',
      label: { en_US: 'Created', zh_Hans: '创建' },
      description: { en_US: 'Created event', zh_Hans: '创建事件' },
      parameters: [],
      labels: [],
      output_schema: {},
    },
  ],
  ...overrides,
})

describe('FeaturedTriggers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseTheme.mockReturnValue({ theme: Theme.light } as ReturnType<typeof useTheme>)
  })

  // The section should persist collapse state and allow expanding recommended rows.
  describe('Visibility Controls', () => {
    it('should persist collapse state in localStorage', async () => {
      const user = userEvent.setup()

      render(<FeaturedTriggers plugins={[]} providerMap={new Map()} onSelect={vi.fn()} />)

      const trigger = screen.getByRole('button', { name: /workflow\.tabs\.featuredTools/ })
      expect(trigger).toHaveAttribute('aria-expanded', 'true')

      trigger.focus()
      await user.keyboard(' ')

      expect(trigger).toHaveAttribute('aria-expanded', 'false')

      expect(
        screen.queryByRole('link', { name: 'workflow.tabs.noFeaturedTriggers' }),
      ).not.toBeInTheDocument()
      expect(globalThis.localStorage.getItem('workflow_triggers_featured_collapsed')).toBe('true')
    })

    it('should reveal installed providers in batches and then return to the initial list', async () => {
      const user = userEvent.setup()
      const providers = Array.from({ length: 11 }).map((_, index) =>
        createTriggerProvider({
          id: `provider-${index}`,
          name: `provider-${index}`,
          label: { en_US: `Provider ${index}`, zh_Hans: `提供商${index}` },
          plugin_id: `plugin-${index}`,
          plugin_unique_identifier: `plugin-${index}@1.0.0`,
        }),
      )
      const providerMap = new Map(providers.map((provider) => [provider.plugin_id!, provider]))
      const plugins = providers.map((provider) =>
        createPlugin({
          plugin_id: provider.plugin_id!,
          latest_package_identifier: provider.plugin_unique_identifier,
        }),
      )

      render(<FeaturedTriggers plugins={plugins} providerMap={providerMap} onSelect={vi.fn()} />)

      expect(screen.getByText('Provider 4')).toBeInTheDocument()
      expect(screen.queryByText('Provider 5')).not.toBeInTheDocument()

      const showMoreButton = screen.getByRole('button', {
        name: 'workflow.tabs.showMoreFeatured',
      })
      await user.click(showMoreButton)
      expect(screen.getByText('Provider 9')).toBeInTheDocument()
      expect(screen.queryByText('Provider 10')).not.toBeInTheDocument()

      await user.click(screen.getByRole('button', { name: 'workflow.tabs.showMoreFeatured' }))
      expect(screen.getByText('Provider 10')).toBeInTheDocument()
      expect(
        screen.getByRole('button', { name: 'workflow.tabs.showLessFeatured' }),
      ).toBeInTheDocument()

      await user.click(screen.getByRole('button', { name: 'workflow.tabs.showLessFeatured' }))
      expect(screen.queryByText('Provider 5')).not.toBeInTheDocument()
      expect(
        screen.getByRole('button', { name: 'workflow.tabs.showMoreFeatured' }),
      ).toBeInTheDocument()
    })
  })

  // Rendering should cover the empty state link and installed trigger selection.
  describe('Rendering and Selection', () => {
    it('should render the empty state link when there are no featured plugins', () => {
      render(<FeaturedTriggers plugins={[]} providerMap={new Map()} onSelect={vi.fn()} />)

      expect(
        screen.getByRole('link', { name: 'workflow.tabs.noFeaturedTriggers' }),
      ).toHaveAttribute('href', 'https://marketplace.test/plugins/trigger')
    })

    it('should select an installed trigger event from the featured list', async () => {
      const user = userEvent.setup()
      const onSelect = vi.fn()
      const provider = createTriggerProvider()

      render(
        <FeaturedTriggers
          plugins={[
            createPlugin({ plugin_id: 'plugin-1', latest_package_identifier: 'plugin-1@1.0.0' }),
          ]}
          providerMap={
            new Map([
              ['plugin-1', provider],
              ['plugin-1@1.0.0', provider],
            ])
          }
          onSelect={onSelect}
        />,
      )

      await user.click(screen.getByText('Provider One'))
      await user.click(screen.getByText('Created'))

      expect(onSelect).toHaveBeenCalledWith(
        BlockEnum.TriggerPlugin,
        expect.objectContaining({
          provider_id: 'provider-one',
          event_name: 'created',
          event_label: 'Created',
        }),
      )
    })

    it('should keep the marketplace link and row actions keyboard reachable', async () => {
      const user = userEvent.setup()

      render(
        <FeaturedTriggers plugins={[createPlugin()]} providerMap={new Map()} onSelect={vi.fn()} />,
      )

      const detailsLink = screen.getByRole('link', { name: 'Plugin One' })
      const installButton = screen.getByRole('button', { name: 'plugin.installAction' })
      const moreButton = screen.getByRole('button', { name: 'common.operation.more' })

      expect(detailsLink).toHaveAttribute(
        'href',
        'https://marketplace.test/plugins/org/trigger-plugin',
      )
      expect(detailsLink).not.toContainElement(installButton)
      expect(detailsLink).not.toContainElement(moreButton)

      detailsLink.focus()
      await user.tab()
      expect(installButton).toHaveFocus()

      await user.tab()
      expect(moreButton).toHaveFocus()
    })
  })
})
