import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CollectionType } from '@/app/components/tools/types'
import { BlockEnum } from '../../../types'
import { createPlugin, createToolProvider } from '../../__tests__/factories'
import { ViewType } from '../../types'
import List from '../list'

vi.mock('#i18n', async (importOriginal) => ({
  ...(await importOriginal<typeof import('#i18n')>()),
  useLocale: () => 'en_US',
}))

vi.mock('@/app/components/workflow/nodes/_base/components/mcp-tool-availability', () => ({
  useMCPToolAvailability: () => ({
    allowed: true,
  }),
}))

vi.mock(
  '@/app/components/plugins/install-plugin/hooks/use-workspace-plugin-install-permission',
  () => ({
    default: () => ({
      canInstallPlugin: true,
      currentDifyVersion: '1.0.0',
    }),
  }),
)

// Installation owns its own status/permission tests; this list owns opening the selected package.
vi.mock('@/app/components/plugins/install-plugin/install-from-marketplace', () => ({
  default: ({ uniqueIdentifier, onClose }: { uniqueIdentifier: string; onClose: () => void }) => (
    <div data-testid="install-from-marketplace">
      {uniqueIdentifier}
      <button type="button" onClick={onClose}>
        install-close
      </button>
    </div>
  ),
}))

describe('RAG tool recommendations list', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render installed tools in flat view and delegate selection', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()

    render(
      <List
        onSelect={onSelect}
        tools={[
          createToolProvider({
            type: CollectionType.builtIn,
            label: { en_US: 'Provider Alpha', zh_Hans: 'Provider Alpha' },
          }),
        ]}
        viewType={ViewType.flat}
        unInstalledPlugins={[]}
      />,
    )

    await user.click(screen.getByText('Provider Alpha'))
    await user.click(screen.getByText('Tool A'))

    expect(onSelect).toHaveBeenCalledWith(
      BlockEnum.Tool,
      expect.objectContaining({
        provider_name: 'provider-one',
        tool_name: 'tool-a',
      }),
    )
  })

  it('should render uninstalled plugins and open their install dialog', async () => {
    const user = userEvent.setup()

    render(
      <List
        tools={[]}
        viewType={ViewType.flat}
        onSelect={vi.fn()}
        unInstalledPlugins={[
          createPlugin({
            latest_package_identifier: 'rag-plugin@1.0.0',
            label: { en_US: 'RAG Plugin', zh_Hans: 'RAG Plugin' },
          }),
        ]}
      />,
    )

    expect(screen.getByText('RAG Plugin')).toBeInTheDocument()

    const installButton = screen.getByRole('button', { name: 'plugin.installAction' })
    await user.tab()
    expect(installButton).toHaveFocus()

    await user.keyboard('{Enter}')

    expect(screen.getByTestId('install-from-marketplace')).toHaveTextContent('rag-plugin@1.0.0')
    await user.click(screen.getByRole('button', { name: 'install-close' }))
    expect(screen.queryByTestId('install-from-marketplace')).not.toBeInTheDocument()
  })
})
