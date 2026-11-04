import type { ComponentProps } from 'react'
import type { PluginPageTab } from '../../context'
import type { FilterState } from '../../filter-management'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useMemo, useRef, useState } from 'react'
import { seedModelProviderQueries } from '@/test/console/model-provider'
import { createConsoleQueryClient, renderWithConsoleQuery } from '@/test/console/query-data'
import { createInstalledPluginFixture } from '@/test/fixtures/plugin'
import { PluginPageContext } from '../../context'
import Empty from '../index'

const requests = vi.hoisted(() => ({ list: vi.fn(), upload: vi.fn() }))
vi.mock('@/service/plugins', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/service/plugins')>()),
  uploadFile: requests.upload,
}))
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses, withConsoleClientResponses } =
    await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'workspaces.current.plugin.list.get': requests.list,
      'workspaces.current.plugin.list.installations.ids.post': () => ({ plugins: [] }),
    }),
    consoleClient: withConsoleClientResponses(actual.consoleClient, {
      'workspaces.current.plugin.permission.fetch.get': () => ({
        install_permission: 'everyone',
        debug_permission: 'everyone',
      }),
      'workspaces.current.plugin.tasks.get': () => ({ tasks: [] }),
    }),
  }
})

function renderEmpty({
  filters = {},
  marketplace = true,
  restricted = false,
  customNavigation = false,
  ...props
}: Partial<ComponentProps<typeof Empty>> & {
  filters?: Partial<FilterState>
  marketplace?: boolean
  restricted?: boolean
  customNavigation?: boolean
} = {}) {
  const initialFilters: FilterState = { categories: [], tags: [], searchQuery: '', ...filters }
  function Caller() {
    const containerRef = useRef<HTMLDivElement>(null)
    const [activeTab, setActiveTab] = useState<PluginPageTab>('plugins')
    const [customOpen, setCustomOpen] = useState(false)
    const value = useMemo(
      () => ({
        containerRef,
        selectedItem: undefined,
        setSelectedItem: () => {},
        filters: initialFilters,
        setFilters: () => {},
        activeTab,
        setActiveTab,
        options: [],
      }),
      [activeTab],
    )
    return (
      <PluginPageContext.Provider value={value}>
        {activeTab === 'discover' && <section aria-label="Discover marketplace" />}
        {customOpen && <section aria-label="Caller marketplace" />}
        <Empty
          {...props}
          onSwitchToMarketplace={
            customNavigation ? () => setCustomOpen(true) : props.onSwitchToMarketplace
          }
        />
      </PluginPageContext.Provider>
    )
  }
  const queryClient = createConsoleQueryClient()
  seedModelProviderQueries(queryClient)
  return renderWithConsoleQuery(<Caller />, {
    queryClient,
    workspacePermissionKeys: ['plugin.install'],
    systemFeatures: {
      rbac_enabled: true,
      enable_marketplace: marketplace,
      plugin_installation_permission: {
        plugin_installation_scope: 'all',
        restrict_to_marketplace_only: restricted,
      },
    },
  })
}

const getFileInput = () => document.querySelector<HTMLInputElement>('input[type="file"]')!
const createFile = (name: string) =>
  new File(['package'], name, { type: 'application/octet-stream' })

beforeEach(() => {
  requests.list.mockReset().mockResolvedValue({ plugins: [], total: 0 })
  // These existing scenarios cancel before uploading finishes. Keep the transport
  // pending so the real upload view and its close action own the interaction.
  requests.upload.mockReset().mockReturnValue(new Promise(() => {}))
})

it('shows the no-installed message even when filters are active', async () => {
  renderEmpty({ filters: { categories: ['model'], searchQuery: 'test' } })
  expect(await screen.findByText('plugin.list.noInstalled')).toBeInTheDocument()
  expect(screen.queryByText('plugin.list.notFound')).not.toBeInTheDocument()
})

it.each([{ categories: ['model'] }, { tags: ['tag1'] }, { searchQuery: 'test query' }])(
  'shows no results for an installed list filtered by %o',
  async (filters) => {
    requests.list.mockResolvedValue({ plugins: [createInstalledPluginFixture()], total: 1 })
    renderEmpty({ filters })
    expect(await screen.findByText('plugin.list.notFound')).toBeInTheDocument()
    expect(screen.queryByText('plugin.list.noInstalled')).not.toBeInTheDocument()
  },
)

it.each([
  { marketplace: true, restricted: false, methods: ['marketplace', 'github', 'local'] },
  { marketplace: true, restricted: true, methods: ['marketplace'] },
  { marketplace: false, restricted: false, methods: ['github', 'local'] },
  { marketplace: false, restricted: true, methods: [] },
])(
  'offers $methods with marketplace=$marketplace and restricted=$restricted',
  ({ marketplace, restricted, methods }) => {
    renderEmpty({ marketplace, restricted })
    for (const method of ['marketplace', 'github', 'local']) {
      const button = screen.queryByRole('button', { name: `plugin.source.${method}` })
      if (methods.includes(method)) expect(button).toBeInTheDocument()
      else expect(button).not.toBeInTheDocument()
    }
  },
)

it('hides installation actions and ignores file changes without install permission', () => {
  renderEmpty({ canInstall: false })
  expect(screen.queryAllByRole('button')).toHaveLength(0)
  fireEvent.change(getFileInput(), { target: { files: [createFile('blocked.difypkg')] } })
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(requests.upload).not.toHaveBeenCalled()
})

it('opens the discovery tab from the marketplace action', async () => {
  const user = userEvent.setup()
  renderEmpty()
  await user.click(screen.getByRole('button', { name: 'plugin.source.marketplace' }))
  expect(screen.getByRole('region', { name: 'Discover marketplace' })).toBeInTheDocument()
})

it('uses the supplied marketplace navigation instead of switching tabs', async () => {
  const user = userEvent.setup()
  renderEmpty({ customNavigation: true })
  await user.click(screen.getByRole('button', { name: 'plugin.source.marketplace' }))
  expect(screen.getByRole('region', { name: 'Caller marketplace' })).toBeInTheDocument()
  expect(screen.queryByRole('region', { name: 'Discover marketplace' })).not.toBeInTheDocument()
})

it('opens, closes, and reopens the real GitHub installer', async () => {
  const user = userEvent.setup()
  renderEmpty()
  await user.click(screen.getByRole('button', { name: 'plugin.source.github' }))
  const dialog = await screen.findByRole('dialog', {
    name: 'plugin.installFromGitHub.installPlugin',
  })
  expect(within(dialog).getByRole('textbox')).toHaveValue('')
  await user.click(within(dialog).getByRole('button', { name: 'plugin.installModal.cancel' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  await user.click(screen.getByRole('button', { name: 'plugin.source.github' }))
  expect(
    await screen.findByRole('dialog', { name: 'plugin.installFromGitHub.installPlugin' }),
  ).toBeInTheDocument()
})

it('opens the file picker for supported plugin and bundle files', async () => {
  const user = userEvent.setup()
  renderEmpty()
  const input = getFileInput()
  const clickSpy = vi.spyOn(input, 'click')
  await user.click(screen.getByRole('button', { name: 'plugin.source.local' }))
  expect(clickSpy).toHaveBeenCalledOnce()
  expect(input).toHaveAttribute('accept', '.difypkg,.difybndl')
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  clickSpy.mockRestore()
})

it('uploads the selected package and accepts a new bundle after closing', async () => {
  const user = userEvent.setup()
  renderEmpty()
  const file = createFile('my-plugin.difypkg')
  await user.upload(getFileInput(), file)
  const dialog = await screen.findByRole('dialog', { name: 'plugin.installModal.installPlugin' })
  expect(within(dialog).getByText(/plugin.installModal.uploadingPackage/)).toHaveTextContent(
    file.name,
  )
  expect(requests.upload).toHaveBeenCalledWith(file, false)
  await user.click(within(dialog).getByRole('button', { name: 'common.operation.cancel' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

  const bundle = createFile('my-bundle.difybndl')
  await user.upload(getFileInput(), bundle)
  const reopened = await screen.findByRole('dialog', { name: 'plugin.installModal.installPlugin' })
  expect(within(reopened).getByText(/plugin.installModal.uploadingPackage/)).toHaveTextContent(
    bundle.name,
  )
  expect(requests.upload).toHaveBeenLastCalledWith(bundle, true)
})

it('does not open an installer when file selection is cancelled', () => {
  renderEmpty()
  fireEvent.change(getFileInput(), { target: { files: [] } })
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(requests.upload).not.toHaveBeenCalled()
})
