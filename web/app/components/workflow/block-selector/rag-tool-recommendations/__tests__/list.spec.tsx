import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CollectionType } from '@/app/components/tools/types'
import { useGetLanguage } from '@/context/i18n'
import useTheme from '@/hooks/use-theme'
import { Theme } from '@/types/app'
import { BlockEnum } from '../../../types'
import { createPlugin, createToolProvider } from '../../__tests__/factories'
import { ViewType } from '../../view-type-select'
import List from '../list'
import UninstalledItem from '../uninstalled-item'

vi.mock('@/context/i18n', () => ({
  useGetLanguage: vi.fn(),
  useLocale: () => 'en_US',
}))

vi.mock('@/hooks/use-theme', () => ({
  default: vi.fn(),
}))

vi.mock('@/app/components/workflow/nodes/_base/components/mcp-tool-availability', () => ({
  useMCPToolAvailability: () => ({
    allowed: true,
  }),
}))

vi.mock('@/app/components/plugins/install-plugin/hooks/use-workspace-plugin-install-permission', () => ({
  default: () => ({
    canInstallPlugin: true,
    currentDifyVersion: '1.0.0',
  }),
}))

vi.mock('@/app/components/plugins/install-plugin/install-from-marketplace', () => ({
  default: ({
    uniqueIdentifier,
    onClose,
  }: {
    uniqueIdentifier: string
    onClose: () => void
  }) => (
    <div data-testid="install-from-marketplace">
      {uniqueIdentifier}
      <button type="button" onClick={onClose}>install-close</button>
    </div>
  ),
}))

const mockUseGetLanguage = vi.mocked(useGetLanguage)
const mockUseTheme = vi.mocked(useTheme)

describe('RAG tool recommendations list', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseGetLanguage.mockReturnValue('en_US')
    mockUseTheme.mockReturnValue({ theme: Theme.light } as ReturnType<typeof useTheme>)
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

    expect(onSelect).toHaveBeenCalledWith(BlockEnum.Tool, expect.objectContaining({
      provider_name: 'provider-one',
      tool_name: 'tool-a',
    }))
  })

  it('should render uninstalled plugins and open their install dialog', async () => {
    const user = userEvent.setup()

    render(
      <UninstalledItem
        payload={createPlugin({
          latest_package_identifier: 'rag-plugin@1.0.0',
          label: { en_US: 'RAG Plugin', zh_Hans: 'RAG Plugin' },
        })}
      />,
    )

    expect(screen.getByText('RAG Plugin')).toBeInTheDocument()

    await user.click(screen.getByText('plugin.installAction'))

    expect(screen.getByTestId('install-from-marketplace')).toHaveTextContent('rag-plugin@1.0.0')
  })
})
