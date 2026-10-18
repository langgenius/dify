import type { ReactElement } from 'react'
import type { PluginDeclaration, PluginDetail } from '../../types'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { renderWithConsoleQuery } from '@/test/console/query-data'
import { createPluginDeclarationFixture } from '@/test/fixtures/plugin'
import { PluginCategoryEnum, PluginSource } from '../../types'
import PluginItem from '../index'

const mockEnableMarketplace = vi.fn(() => true)

const mockTheme = vi.fn(() => 'light')
vi.mock('@/hooks/use-theme', () => ({
  default: () => ({ theme: mockTheme() }),
}))

const mockSelectedItem = vi.fn((): { type: 'plugin'; id: string } | undefined => undefined)
const mockSetSelectedItem = vi.fn()
vi.mock('../../plugin-page/context', () => ({
  usePluginPageContext: (selector: (v: Record<string, unknown>) => unknown) => {
    const context = {
      selectedItem: mockSelectedItem(),
      setSelectedItem: mockSetSelectedItem,
    }
    return selector(context)
  },
}))

const mockRefreshPluginList = vi.fn()
vi.mock('@/app/components/plugins/install-plugin/hooks/use-refresh-plugin-list', () => ({
  default: () => ({ refreshPluginList: mockRefreshPluginList }),
}))

const mockLangGeniusVersionInfo = vi.fn(() => ({
  current_env: '',
  current_version: '1.0.0',
  latest_version: '',
  release_notes: '',
  version: '',
}))

const createLangGeniusVersionInfo = (currentVersion: string) => ({
  current_env: '',
  current_version: currentVersion,
  latest_version: '',
  release_notes: '',
  version: '',
})

const render = (ui: ReactElement) =>
  renderWithConsoleQuery(ui, {
    accountProfileMeta: {
      currentVersion: mockLangGeniusVersionInfo().current_version,
    },
    systemFeatures: { enable_marketplace: mockEnableMarketplace() },
  })

const requests = vi.hoisted(() => ({ uninstall: vi.fn() }))
vi.mock('@/service/plugins', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/service/plugins')>()),
  uninstallPlugin: requests.uninstall,
}))

vi.mock('@/context/modal-context', () => ({
  useModalContext: () => ({ setShowUpdatePluginModal: vi.fn() }),
}))

const createPluginDeclaration = (overrides: Partial<PluginDeclaration> = {}): PluginDeclaration =>
  createPluginDeclarationFixture({
    plugin_unique_identifier: 'test-plugin-id',
    icon_dark: 'test-icon-dark.png',
    name: 'test-plugin',
    description: {
      ...createPluginDeclarationFixture().description,
      en_US: 'Test plugin description',
    },
    verified: false,
    endpoint: undefined,
    meta: { version: '1.0.0', minimum_dify_version: '0.5.0' },
    ...overrides,
  })

const createPluginDetail = (overrides: Partial<PluginDetail> = {}): PluginDetail => ({
  id: 'plugin-1',
  created_at: '2024-01-01',
  updated_at: '2024-01-01',
  name: 'test-plugin',
  plugin_id: 'plugin-1',
  plugin_unique_identifier: 'test-author/test-plugin@1.0.0',
  declaration: createPluginDeclaration(),
  installation_id: 'install-1',
  tenant_id: 'tenant-1',
  endpoints_setups: 0,
  endpoints_active: 0,
  version: '1.0.0',
  latest_version: '1.0.0',
  latest_unique_identifier: 'test-author/test-plugin@1.0.0',
  source: PluginSource.marketplace,
  meta: {
    repo: 'test-author/test-plugin',
    version: '1.0.0',
    package: 'test-plugin.difypkg',
  },
  status: 'active',
  deprecated_reason: '',
  alternative_plugin_id: '',
  ...overrides,
})

beforeEach(() => {
  vi.clearAllMocks()
  requests.uninstall.mockResolvedValue({ success: true })
  mockTheme.mockReturnValue('light')
  mockSelectedItem.mockReturnValue(undefined)
  mockEnableMarketplace.mockReturnValue(true)
  mockLangGeniusVersionInfo.mockReturnValue(createLangGeniusVersionInfo('1.0.0'))
})

describe('Installed plugin card', () => {
  it.each([
    { source: PluginSource.github, label: 'GitHub', version: '1.5.0', author: true },
    { source: PluginSource.marketplace, label: 'marketplace', version: '2.0.0', author: true },
    { source: PluginSource.local, label: 'Local Plugin', version: '2.0.0', author: false },
    { source: PluginSource.debugging, label: 'Debugging Plugin', version: '2.0.0', author: false },
  ])(
    'shows the source and correct installed version for $source plugins',
    ({ source, label, version, author }) => {
      render(
        <PluginItem
          plugin={createPluginDetail({
            source,
            version: '2.0.0',
            meta: { repo: 'owner/repo', version: '1.5.0', package: 'pkg.difypkg' },
          })}
        />,
      )
      expect(screen.getByRole('button', { name: 'Test Plugin' })).toBeInTheDocument()
      expect(screen.getByText('Test plugin description')).toBeInTheDocument()
      expect(screen.getByText(label)).toBeInTheDocument()
      expect(screen.getByText(version)).toBeInTheDocument()
      expect(!!screen.queryByText('test-author')).toBe(author)
      if (source === PluginSource.github)
        expect(screen.getByRole('link', { name: /GitHub/ })).toHaveAttribute(
          'href',
          'https://github.com/owner/repo',
        )
      else if (source === PluginSource.marketplace)
        expect(screen.getByRole('link', { name: /marketplace/ })).toHaveAttribute(
          'href',
          expect.stringContaining('/plugins/test-author/test-plugin'),
        )
      else expect(screen.queryByRole('link')).not.toBeInTheDocument()
    },
  )

  it('counts visible endpoint declarations independently of active endpoint instances', () => {
    render(
      <PluginItem
        plugin={createPluginDetail({
          declaration: createPluginDeclaration({
            endpoint: {
              settings: [],
              endpoints: [
                { path: '/first', method: 'POST' },
                { path: '/second', method: 'GET' },
                { path: '/hidden', method: 'GET', hidden: true },
              ],
            },
          }),
          endpoints_active: 0,
        })}
      />,
    )
    expect(screen.getByText('plugin.endpointsEnabled:{"num":2}')).toBeInTheDocument()
  })

  it.each(['0.3.0', '0.5.0', '1.0.0'])(
    'warns when Dify %s cannot run the installed plugin',
    (version) => {
      mockLangGeniusVersionInfo.mockReturnValue(createLangGeniusVersionInfo(version))
      render(<PluginItem plugin={createPluginDetail()} />)
      expect(!!screen.queryByRole('button', { name: /plugin.difyVersionNotCompatible/ })).toBe(
        version === '0.3.0',
      )
    },
  )

  it.each([
    { source: PluginSource.marketplace, enabled: true, expected: true },
    { source: PluginSource.marketplace, enabled: false, expected: false },
    { source: PluginSource.github, enabled: true, expected: false },
  ])(
    'reports withdrawal only for available marketplace entries: %j',
    ({ source, enabled, expected }) => {
      mockEnableMarketplace.mockReturnValue(enabled)
      const plugin = createPluginDetail({ source })
      const { rerender } = render(<PluginItem plugin={plugin} />)
      expect(screen.queryByText('plugin.deprecated')).not.toBeInTheDocument()
      rerender(
        <PluginItem
          plugin={{ ...plugin, status: 'deleted', deprecated_reason: 'No longer maintained' }}
        />,
      )
      expect(!!screen.queryByText('plugin.deprecated')).toBe(expected)
      if (!enabled)
        expect(screen.queryByRole('link', { name: /marketplace/ })).not.toBeInTheDocument()
    },
  )

  it('selects the plugin from the card and keeps its actions separate', async () => {
    const user = userEvent.setup()
    render(<PluginItem plugin={createPluginDetail()} />)
    const card = screen.getByRole('button', { name: 'Test Plugin' })
    await user.tab()
    expect(card).toHaveFocus()
    await user.keyboard('{Enter}')
    expect(mockSetSelectedItem).toHaveBeenCalledExactlyOnceWith({ type: 'plugin', id: 'plugin-1' })
    mockSetSelectedItem.mockClear()
    const action = screen.getByRole('button', { name: 'plugin.action.delete' })
    expect(card).not.toContainElement(action)
    expect(card).not.toContainElement(screen.getByRole('link', { name: /marketplace/ }))
    await user.click(action)
    expect(screen.getByRole('alertdialog', { name: 'plugin.action.delete' })).toHaveTextContent(
      'test-plugin',
    )
    expect(mockSetSelectedItem).not.toHaveBeenCalled()
  })

  it('refreshes the current plugin category after a real uninstall succeeds', async () => {
    const user = userEvent.setup()
    const { rerender } = render(<PluginItem plugin={createPluginDetail()} />)
    rerender(
      <PluginItem
        plugin={createPluginDetail({
          installation_id: 'new-installation',
          declaration: createPluginDeclaration({ category: PluginCategoryEnum.model }),
        })}
      />,
    )
    await user.click(screen.getByRole('button', { name: 'plugin.action.delete' }))
    await user.click(screen.getByRole('button', { name: 'common.operation.confirm' }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
    expect(requests.uninstall).toHaveBeenCalledExactlyOnceWith('new-installation')
    expect(mockRefreshPluginList).toHaveBeenCalledExactlyOnceWith({
      category: PluginCategoryEnum.model,
    })
  })

  it.each([
    { source: PluginSource.github, canDelete: true, canUpdate: true, update: true, info: true },
    { source: PluginSource.github, canDelete: false, canUpdate: false, update: false, info: true },
    {
      source: PluginSource.marketplace,
      canDelete: false,
      canUpdate: true,
      update: false,
      info: false,
    },
  ])(
    'exposes permitted actions for $source (delete: $canDelete, update: $canUpdate)',
    ({ source, canDelete, canUpdate, update, info }) => {
      render(
        <PluginItem
          plugin={createPluginDetail({ source })}
          canDeletePlugin={canDelete}
          canUpdatePlugin={canUpdate}
        />,
      )
      expect(!!screen.queryByRole('button', { name: 'plugin.action.delete' })).toBe(canDelete)
      expect(!!screen.queryByRole('button', { name: 'plugin.action.checkForUpdates' })).toBe(update)
      expect(!!screen.queryByRole('button', { name: 'plugin.action.pluginInfo' })).toBe(info)
    },
  )

  it.each([
    { theme: 'dark', icon: 'light.png', dark: 'dark.png', expected: 'dark.png' },
    { theme: 'light', icon: 'light.png', dark: 'dark.png', expected: 'light.png' },
    { theme: 'dark', icon: 'light.png', dark: undefined, expected: 'light.png' },
    {
      theme: 'light',
      icon: 'https://example.com/icon.png',
      dark: undefined,
      expected: 'https://example.com/icon.png',
    },
  ])('resolves the plugin icon in $theme mode: $expected', ({ theme, icon, dark, expected }) => {
    mockTheme.mockReturnValue(theme)
    render(
      <PluginItem
        plugin={createPluginDetail({
          declaration: createPluginDeclaration({ icon, icon_dark: dark }),
        })}
      />,
    )
    expect(screen.getByRole('presentation')).toHaveAttribute(
      'src',
      expect.stringContaining(expected),
    )
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
  })
})
