import type { ToolWithProvider } from '../../types'
import type { ToolValue } from '../types'
import type { Plugin } from '@/app/components/plugins/types'
import type { Tool } from '@/app/components/tools/types'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useTags } from '@/app/components/plugins/hooks'
import { useMarketplacePlugins } from '@/app/components/plugins/marketplace/hooks'
import { PluginCategoryEnum } from '@/app/components/plugins/types'
import { CollectionType } from '@/app/components/tools/types'
import { useGlobalPublicStore } from '@/context/global-public-context'
import { useGetLanguage } from '@/context/i18n'
import useTheme from '@/hooks/use-theme'
import { createCustomCollection } from '@/service/tools'
import { useFeaturedToolsRecommendations } from '@/service/use-plugins'
import {
  useAllBuiltInTools,
  useAllCustomTools,
  useAllMCPTools,
  useAllWorkflowTools,
  useInvalidateAllBuiltInTools,
  useInvalidateAllCustomTools,
  useInvalidateAllMCPTools,
  useInvalidateAllWorkflowTools,
} from '@/service/use-tools'
import { Theme } from '@/types/app'
import { defaultSystemFeatures } from '@/types/feature'
import ToolPicker from '../tool-picker'

const mockNotify = vi.fn()
const mockSetSystemFeatures = vi.fn()
const mockInvalidateBuiltInTools = vi.fn()
const mockInvalidateCustomTools = vi.fn()
const mockInvalidateWorkflowTools = vi.fn()
const mockInvalidateMcpTools = vi.fn()
const mockCreateCustomCollection = vi.mocked(createCustomCollection)
const mockInstallPackageFromMarketPlace = vi.fn()
const mockCheckInstalled = vi.fn()
const mockRefreshPluginList = vi.fn()

const mockUseGlobalPublicStore = vi.mocked(useGlobalPublicStore)
const mockUseGetLanguage = vi.mocked(useGetLanguage)
const mockUseTheme = vi.mocked(useTheme)
const mockUseTags = vi.mocked(useTags)
const mockUseMarketplacePlugins = vi.mocked(useMarketplacePlugins)
const mockUseAllBuiltInTools = vi.mocked(useAllBuiltInTools)
const mockUseAllCustomTools = vi.mocked(useAllCustomTools)
const mockUseAllWorkflowTools = vi.mocked(useAllWorkflowTools)
const mockUseAllMCPTools = vi.mocked(useAllMCPTools)
const mockUseInvalidateAllBuiltInTools = vi.mocked(useInvalidateAllBuiltInTools)
const mockUseInvalidateAllCustomTools = vi.mocked(useInvalidateAllCustomTools)
const mockUseInvalidateAllWorkflowTools = vi.mocked(useInvalidateAllWorkflowTools)
const mockUseInvalidateAllMCPTools = vi.mocked(useInvalidateAllMCPTools)
const mockUseFeaturedToolsRecommendations = vi.mocked(useFeaturedToolsRecommendations)

vi.mock('@/context/global-public-context', () => ({
  useGlobalPublicStore: vi.fn(),
}))

vi.mock('@/context/i18n', () => ({
  useGetLanguage: vi.fn(),
}))

vi.mock('@/hooks/use-theme', () => ({
  default: vi.fn(),
}))

vi.mock('@/app/components/plugins/hooks', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/app/components/plugins/hooks')>()
  return {
    ...actual,
    useTags: vi.fn(),
  }
})

vi.mock('@/app/components/plugins/marketplace/hooks', () => ({
  useMarketplacePlugins: vi.fn(),
}))

vi.mock('@/service/tools', () => ({
  createCustomCollection: vi.fn(),
}))

vi.mock('@/service/use-plugins', () => ({
  useFeaturedToolsRecommendations: vi.fn(),
  useDownloadPlugin: vi.fn(() => ({
    data: undefined,
    isLoading: false,
  })),
  useInstallPackageFromMarketPlace: () => ({
    mutateAsync: mockInstallPackageFromMarketPlace,
    isPending: false,
  }),
  usePluginDeclarationFromMarketPlace: () => ({
    data: undefined,
  }),
  usePluginTaskList: () => ({
    handleRefetch: vi.fn(),
  }),
  useUpdatePackageFromMarketPlace: () => ({
    mutateAsync: vi.fn(),
  }),
}))

vi.mock('@/service/use-tools', () => ({
  useAllBuiltInTools: vi.fn(),
  useAllCustomTools: vi.fn(),
  useAllWorkflowTools: vi.fn(),
  useAllMCPTools: vi.fn(),
  useInvalidateAllBuiltInTools: vi.fn(),
  useInvalidateAllCustomTools: vi.fn(),
  useInvalidateAllWorkflowTools: vi.fn(),
  useInvalidateAllMCPTools: vi.fn(),
}))

vi.mock('@/app/components/base/ui/toast', () => ({
  toast: {
    success: (message: string) => mockNotify({ type: 'success', message }),
    error: (message: string) => mockNotify({ type: 'error', message }),
    warning: (message: string) => mockNotify({ type: 'warning', message }),
    info: (message: string) => mockNotify({ type: 'info', message }),
  },
}))

vi.mock('@/app/components/base/amplitude', () => ({
  trackEvent: vi.fn(),
}))

vi.mock('next-themes', () => ({
  useTheme: () => ({ theme: Theme.light }),
}))

vi.mock('@/app/components/tools/edit-custom-collection-modal', () => ({
  default: ({
    onAdd,
    onHide,
  }: {
    onAdd: (payload: { name: string }) => Promise<void>
    onHide: () => void
  }) => (
    <div data-testid="edit-custom-tool-modal">
      <button type="button" onClick={() => onAdd({ name: 'collection-a' })}>submit-custom-tool</button>
      <button type="button" onClick={onHide}>hide-custom-tool</button>
    </div>
  ),
}))

vi.mock('@/app/components/plugins/install-plugin/hooks/use-check-installed', () => ({
  default: () => mockCheckInstalled(),
}))

vi.mock('@/app/components/plugins/install-plugin/hooks/use-install-plugin-limit', () => ({
  default: () => ({
    canInstall: true,
  }),
}))

vi.mock('@/app/components/plugins/install-plugin/hooks/use-refresh-plugin-list', () => ({
  default: () => ({
    refreshPluginList: mockRefreshPluginList,
  }),
}))

vi.mock('@/app/components/plugins/install-plugin/base/check-task-status', () => ({
  default: () => ({
    check: vi.fn().mockResolvedValue({ status: 'success' }),
    stop: vi.fn(),
  }),
}))

vi.mock('@/app/components/plugins/install-plugin/install-from-marketplace', () => ({
  default: ({
    onSuccess,
    onClose,
  }: {
    onSuccess: () => void | Promise<void>
    onClose: () => void
  }) => (
    <div data-testid="install-from-marketplace">
      <button type="button" onClick={() => onSuccess()}>complete-featured-install</button>
      <button type="button" onClick={onClose}>cancel-featured-install</button>
    </div>
  ),
}))

vi.mock('@/utils/var', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/utils/var')>()
  return {
    ...actual,
    getMarketplaceUrl: () => 'https://marketplace.test/tools',
  }
})

const createTool = (
  name: string,
  label: string,
  description = `${label} description`,
): Tool => ({
  name,
  author: 'author',
  label: {
    en_US: label,
    zh_Hans: label,
  },
  description: {
    en_US: description,
    zh_Hans: description,
  },
  parameters: [],
  labels: [],
  output_schema: {},
})

const createToolProvider = (
  overrides: Partial<ToolWithProvider> = {},
): ToolWithProvider => ({
  id: 'provider-1',
  name: 'provider-one',
  author: 'Provider Author',
  description: {
    en_US: 'Provider description',
    zh_Hans: 'Provider description',
  },
  icon: 'icon',
  icon_dark: 'icon-dark',
  label: {
    en_US: 'Provider One',
    zh_Hans: 'Provider One',
  },
  type: CollectionType.builtIn,
  team_credentials: {},
  is_team_authorization: false,
  allow_delete: false,
  labels: [],
  plugin_id: 'plugin-1',
  tools: [createTool('tool-a', 'Tool A')],
  meta: { version: '1.0.0' } as ToolWithProvider['meta'],
  plugin_unique_identifier: 'plugin-1@1.0.0',
  ...overrides,
})

const createToolValue = (overrides: Partial<ToolValue> = {}): ToolValue => ({
  provider_name: 'provider-a',
  tool_name: 'tool-a',
  tool_label: 'Tool A',
  ...overrides,
})

const createPlugin = (overrides: Partial<Plugin> = {}): Plugin => ({
  type: 'plugin',
  org: 'org',
  author: 'author',
  name: 'Plugin One',
  plugin_id: 'plugin-1',
  version: '1.0.0',
  latest_version: '1.0.0',
  latest_package_identifier: 'plugin-1@1.0.0',
  icon: 'icon',
  verified: true,
  label: { en_US: 'Plugin One' },
  brief: { en_US: 'Brief' },
  description: { en_US: 'Plugin description' },
  introduction: 'Intro',
  repository: 'https://example.com',
  category: PluginCategoryEnum.tool,
  install_count: 0,
  endpoint: { settings: [] },
  tags: [{ name: 'tag-a' }],
  badges: [],
  verification: { authorized_category: 'community' },
  from: 'marketplace',
  ...overrides,
})

const builtInTools = [
  createToolProvider({
    id: 'built-in-1',
    name: 'built-in-provider',
    label: { en_US: 'Built-in Provider', zh_Hans: 'Built-in Provider' },
    tools: [createTool('built-in-tool', 'Built-in Tool')],
  }),
]

const customTools = [
  createToolProvider({
    id: 'custom-1',
    name: 'custom-provider',
    label: { en_US: 'Custom Provider', zh_Hans: 'Custom Provider' },
    type: CollectionType.custom,
    tools: [createTool('weather-tool', 'Weather Tool')],
  }),
]

const workflowTools = [
  createToolProvider({
    id: 'workflow-1',
    name: 'workflow-provider',
    label: { en_US: 'Workflow Provider', zh_Hans: 'Workflow Provider' },
    type: CollectionType.workflow,
    tools: [createTool('workflow-tool', 'Workflow Tool')],
  }),
]

const mcpTools = [
  createToolProvider({
    id: 'mcp-1',
    name: 'mcp-provider',
    label: { en_US: 'MCP Provider', zh_Hans: 'MCP Provider' },
    type: CollectionType.mcp,
    tools: [createTool('mcp-tool', 'MCP Tool')],
  }),
]

const renderToolPicker = (props: Partial<React.ComponentProps<typeof ToolPicker>> = {}) => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  })

  return render(
    <QueryClientProvider client={queryClient}>
      <ToolPicker
        disabled={false}
        trigger={<button type="button">open-picker</button>}
        isShow={false}
        onShowChange={vi.fn()}
        onSelect={vi.fn()}
        onSelectMultiple={vi.fn()}
        selectedTools={[createToolValue()]}
        {...props}
      />
    </QueryClientProvider>,
  )
}

describe('ToolPicker', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mockUseGlobalPublicStore.mockImplementation(selector => selector({
      systemFeatures: {
        ...defaultSystemFeatures,
        enable_marketplace: true,
      },
      setSystemFeatures: mockSetSystemFeatures,
    }))
    mockUseGetLanguage.mockReturnValue('en_US')
    mockUseTheme.mockReturnValue({ theme: Theme.light } as ReturnType<typeof useTheme>)
    mockUseTags.mockReturnValue({
      tags: [{ name: 'weather', label: 'Weather' }],
      tagsMap: { weather: { name: 'weather', label: 'Weather' } },
      getTagLabel: (name: string) => name,
    })
    mockUseMarketplacePlugins.mockReturnValue({
      plugins: [],
      total: 0,
      resetPlugins: vi.fn(),
      queryPlugins: vi.fn(),
      queryPluginsWithDebounced: vi.fn(),
      cancelQueryPluginsWithDebounced: vi.fn(),
      isLoading: false,
      isFetchingNextPage: false,
      hasNextPage: false,
      fetchNextPage: vi.fn(),
      page: 0,
    } as ReturnType<typeof useMarketplacePlugins>)
    mockUseAllBuiltInTools.mockReturnValue({ data: builtInTools } as ReturnType<typeof useAllBuiltInTools>)
    mockUseAllCustomTools.mockReturnValue({ data: customTools } as ReturnType<typeof useAllCustomTools>)
    mockUseAllWorkflowTools.mockReturnValue({ data: workflowTools } as ReturnType<typeof useAllWorkflowTools>)
    mockUseAllMCPTools.mockReturnValue({ data: mcpTools } as ReturnType<typeof useAllMCPTools>)
    mockUseInvalidateAllBuiltInTools.mockReturnValue(mockInvalidateBuiltInTools)
    mockUseInvalidateAllCustomTools.mockReturnValue(mockInvalidateCustomTools)
    mockUseInvalidateAllWorkflowTools.mockReturnValue(mockInvalidateWorkflowTools)
    mockUseInvalidateAllMCPTools.mockReturnValue(mockInvalidateMcpTools)
    mockUseFeaturedToolsRecommendations.mockReturnValue({
      plugins: [],
      isLoading: false,
    } as ReturnType<typeof useFeaturedToolsRecommendations>)
    mockCreateCustomCollection.mockResolvedValue(undefined)
    mockInstallPackageFromMarketPlace.mockResolvedValue({
      all_installed: true,
      task_id: 'task-1',
    })
    mockCheckInstalled.mockReturnValue({
      installedInfo: undefined,
      isLoading: false,
      error: undefined,
    })
    window.localStorage.clear()
  })

  it('should request opening when the trigger is clicked unless the picker is disabled', async () => {
    const user = userEvent.setup()
    const onShowChange = vi.fn()
    const disabledOnShowChange = vi.fn()

    renderToolPicker({ onShowChange })

    await user.click(screen.getByRole('button', { name: 'open-picker' }))
    expect(onShowChange).toHaveBeenCalledWith(true)

    renderToolPicker({
      disabled: true,
      onShowChange: disabledOnShowChange,
    })

    await user.click(screen.getAllByRole('button', { name: 'open-picker' })[1]!)
    expect(disabledOnShowChange).not.toHaveBeenCalled()
  })

  it('should render real search and tool lists, then forward tool selections', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    const onSelectMultiple = vi.fn()
    const queryPluginsWithDebounced = vi.fn()

    mockUseMarketplacePlugins.mockReturnValue({
      plugins: [],
      total: 0,
      resetPlugins: vi.fn(),
      queryPlugins: vi.fn(),
      queryPluginsWithDebounced,
      cancelQueryPluginsWithDebounced: vi.fn(),
      isLoading: false,
      isFetchingNextPage: false,
      hasNextPage: false,
      fetchNextPage: vi.fn(),
      page: 0,
    } as ReturnType<typeof useMarketplacePlugins>)

    renderToolPicker({
      isShow: true,
      scope: 'custom',
      onSelect,
      onSelectMultiple,
      selectedTools: [],
    })

    expect(screen.queryByText('Built-in Provider')).not.toBeInTheDocument()
    expect(screen.getByText('Custom Provider')).toBeInTheDocument()
    expect(screen.getByText('MCP Provider')).toBeInTheDocument()

    await user.type(screen.getByRole('textbox'), 'weather')

    await waitFor(() => {
      expect(queryPluginsWithDebounced).toHaveBeenLastCalledWith({
        query: 'weather',
        tags: [],
        category: PluginCategoryEnum.tool,
      })
    })

    await waitFor(() => {
      expect(screen.getByText('Weather Tool')).toBeInTheDocument()
    })
    await user.click(screen.getByText('Weather Tool'))

    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({
      provider_name: 'custom-provider',
      tool_name: 'weather-tool',
      tool_label: 'Weather Tool',
    }))

    await user.hover(screen.getByText('Custom Provider'))
    await user.click(screen.getByText('workflow.tabs.addAll'))

    expect(onSelectMultiple).toHaveBeenCalledWith([
      expect.objectContaining({
        provider_name: 'custom-provider',
        tool_name: 'weather-tool',
        tool_label: 'Weather Tool',
      }),
    ])
  })

  it('should create a custom collection from the add button and refresh custom tools', async () => {
    const user = userEvent.setup()
    const { container } = renderToolPicker({
      isShow: true,
      supportAddCustomTool: true,
    })

    const addCustomToolButton = Array.from(container.querySelectorAll('button')).find((button) => {
      return button.className.includes('bg-components-button-primary-bg')
    })

    expect(addCustomToolButton).toBeTruthy()

    await user.click(addCustomToolButton!)
    expect(screen.getByTestId('edit-custom-tool-modal')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'submit-custom-tool' }))

    await waitFor(() => {
      expect(mockCreateCustomCollection).toHaveBeenCalledWith({ name: 'collection-a' })
    })
    expect(mockNotify).toHaveBeenCalledWith({
      type: 'success',
      message: 'common.api.actionSuccess',
    })
    expect(mockInvalidateCustomTools).toHaveBeenCalledTimes(1)
    expect(screen.queryByTestId('edit-custom-tool-modal')).not.toBeInTheDocument()
  })

  it('should invalidate all tool collections after featured install succeeds', async () => {
    const user = userEvent.setup()

    mockUseFeaturedToolsRecommendations.mockReturnValue({
      plugins: [createPlugin({ plugin_id: 'featured-1', latest_package_identifier: 'featured-1@1.0.0' })],
      isLoading: false,
    } as ReturnType<typeof useFeaturedToolsRecommendations>)

    renderToolPicker({
      isShow: true,
      selectedTools: [],
    })

    const featuredPluginItem = await screen.findByText('Plugin One')
    await user.hover(featuredPluginItem)
    await user.click(screen.getByRole('button', { name: 'plugin.installAction' }))
    expect(await screen.findByTestId('install-from-marketplace')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'complete-featured-install' }))

    await waitFor(() => {
      expect(mockInvalidateBuiltInTools).toHaveBeenCalledTimes(1)
      expect(mockInvalidateCustomTools).toHaveBeenCalledTimes(1)
      expect(mockInvalidateWorkflowTools).toHaveBeenCalledTimes(1)
      expect(mockInvalidateMcpTools).toHaveBeenCalledTimes(1)
    }, { timeout: 3000 })
  })
})
