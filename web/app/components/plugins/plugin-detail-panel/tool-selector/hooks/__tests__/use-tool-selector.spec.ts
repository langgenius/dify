import type { ToolValue } from '@/app/components/workflow/block-selector/types'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { CollectionType } from '@/app/components/tools/types'
import { createConsoleQueryClient, createConsoleQueryWrapper } from '@/test/console/query-data'
import { createToolProviderFixture } from '@/test/console/tool-provider-fixture'
import { seedToolProviders } from '@/test/console/tool-providers'
import { useToolSelector } from '../use-tool-selector'

let queryClient = createConsoleQueryClient()
let queryClientWrapper = createConsoleQueryWrapper({ queryClient }).wrapper

const mockToolParams = [
  {
    name: 'param1',
    form: 'llm' as const,
    type: 'string' as const,
    required: true,
    label: { en_US: 'Param 1' },
  },
  {
    name: 'param2',
    form: 'form' as const,
    type: 'number' as const,
    required: false,
    label: { en_US: 'Param 2' },
  },
]

const mockTools = [
  createToolProviderFixture({
    id: 'test-provider',
    name: 'Test Provider',
    plugin_id: 'org/test-plugin',
    type: CollectionType.builtIn,
    tools: [
      {
        name: 'test-tool',
        author: 'Dify',
        label: { en_US: 'Test Tool' },
        description: { en_US: 'A test tool' },
        parameters: mockToolParams,
      },
    ],
  }),
]

vi.mock('@/service/use-plugins', () => ({
  useInvalidateInstalledPluginList: () => vi.fn().mockResolvedValue(undefined),
}))

const mockUsePluginInstalledCheck = vi.fn()

vi.mock('../use-plugin-installed-check', () => ({
  usePluginInstalledCheck: (...args: unknown[]) => mockUsePluginInstalledCheck(...args),
}))

vi.mock('@/utils/get-icon', () => ({
  getIconFromMarketPlace: () => '',
}))

describe('useToolSelector', () => {
  const mockOnSelect = vi.fn()
  const _mockOnSelectMultiple = vi.fn()

  const toolValue: ToolValue = {
    provider_name: 'test-provider',
    provider_show_name: 'Test Provider',
    plugin_id: 'org/test-plugin',
    tool_name: 'test-tool',
    tool_label: 'Test Tool',
    tool_description: 'A test tool',
    settings: {},
    parameters: {},
    enabled: true,
    type: CollectionType.builtIn,
  }

  beforeEach(() => {
    vi.clearAllMocks()
    queryClient = createConsoleQueryClient()
    queryClientWrapper = createConsoleQueryWrapper({ queryClient }).wrapper
    seedToolProviders(queryClient, {
      builtInTools: mockTools,
      customTools: [],
      workflowTools: [],
      mcpTools: [],
    })
    mockUsePluginInstalledCheck.mockReturnValue({
      inMarketPlace: false,
      manifest: null,
      pluginID: '',
    })
  })

  it('should initialize with default panel states', () => {
    const { result } = renderHook(() => useToolSelector({ onSelect: mockOnSelect }), {
      wrapper: queryClientWrapper,
    })

    expect(result.current.isShow).toBe(false)
    expect(result.current.isShowChooseTool).toBe(false)
    expect(result.current.currType).toBe('settings')
  })

  it('should find current provider from tool value', () => {
    const { result } = renderHook(
      () => useToolSelector({ value: toolValue, onSelect: mockOnSelect }),
      { wrapper: queryClientWrapper },
    )

    expect(result.current.currentProvider).toBeDefined()
    expect(result.current.currentProvider?.id).toBe('test-provider')
  })

  it('should find current tool from provider', () => {
    const { result } = renderHook(
      () => useToolSelector({ value: toolValue, onSelect: mockOnSelect }),
      { wrapper: queryClientWrapper },
    )

    expect(result.current.currentTool).toBeDefined()
    expect(result.current.currentTool?.name).toBe('test-tool')
  })

  it('should compute tool settings and params correctly', () => {
    const { result } = renderHook(
      () => useToolSelector({ value: toolValue, onSelect: mockOnSelect }),
      { wrapper: queryClientWrapper },
    )

    // param2 has form='form' (not 'llm'), so it goes to settings
    expect(result.current.currentToolSettings).toHaveLength(1)
    expect(result.current.settingsFormSchemas[0]!.variable).toBe('param2')

    // param1 has form='llm', so it goes to params
    expect(result.current.currentToolParams).toHaveLength(1)
    expect(result.current.paramsFormSchemas[0]).toEqual(
      expect.objectContaining({ variable: 'param1', type: 'text-input', required: true }),
    )
  })

  it('should show tab slider when both settings and params exist', () => {
    const { result } = renderHook(
      () => useToolSelector({ value: toolValue, onSelect: mockOnSelect }),
      { wrapper: queryClientWrapper },
    )

    expect(result.current.showTabSlider).toBe(true)
    expect(result.current.userSettingsOnly).toBe(false)
    expect(result.current.reasoningConfigOnly).toBe(false)
  })

  it('should toggle panel visibility', () => {
    const { result } = renderHook(() => useToolSelector({ onSelect: mockOnSelect }), {
      wrapper: queryClientWrapper,
    })

    act(() => {
      result.current.setIsShow(true)
    })
    expect(result.current.isShow).toBe(true)

    act(() => {
      result.current.setIsShowChooseTool(true)
    })
    expect(result.current.isShowChooseTool).toBe(true)
  })

  it('should switch tab type', () => {
    const { result } = renderHook(() => useToolSelector({ onSelect: mockOnSelect }), {
      wrapper: queryClientWrapper,
    })

    act(() => {
      result.current.setCurrType('params')
    })
    expect(result.current.currType).toBe('params')
  })

  it('should handle description change', () => {
    const { result } = renderHook(
      () => useToolSelector({ value: toolValue, onSelect: mockOnSelect }),
      { wrapper: queryClientWrapper },
    )

    act(() => {
      result.current.handleDescriptionChange('New description')
    })

    expect(mockOnSelect).toHaveBeenCalledWith(
      expect.objectContaining({
        extra: expect.objectContaining({ description: 'New description' }),
      }),
    )
  })

  it('should handle enabled change', () => {
    const { result } = renderHook(
      () => useToolSelector({ value: toolValue, onSelect: mockOnSelect }),
      { wrapper: queryClientWrapper },
    )

    act(() => {
      result.current.handleEnabledChange(false)
    })

    expect(mockOnSelect).toHaveBeenCalledWith(
      expect.objectContaining({
        enabled: false,
      }),
    )
  })

  it('should handle authorization item click', () => {
    const { result } = renderHook(
      () => useToolSelector({ value: toolValue, onSelect: mockOnSelect }),
      { wrapper: queryClientWrapper },
    )

    act(() => {
      result.current.handleAuthorizationItemClick('cred-123')
    })

    expect(mockOnSelect).toHaveBeenCalledWith(
      expect.objectContaining({
        credential_id: 'cred-123',
      }),
    )
  })

  it('should not call onSelect if value is undefined', () => {
    const { result } = renderHook(() => useToolSelector({ onSelect: mockOnSelect }), {
      wrapper: queryClientWrapper,
    })

    act(() => {
      result.current.handleEnabledChange(true)
    })
    expect(mockOnSelect).not.toHaveBeenCalled()
  })

  it('should return empty arrays when no provider matches', () => {
    const { result } = renderHook(
      () =>
        useToolSelector({
          value: { ...toolValue, provider_name: 'nonexistent' },
          onSelect: mockOnSelect,
        }),
      { wrapper: queryClientWrapper },
    )

    expect(result.current.currentProvider).toBeUndefined()
    expect(result.current.currentTool).toBeUndefined()
    expect(result.current.currentToolSettings).toEqual([])
    expect(result.current.currentToolParams).toEqual([])
  })

  it('should skip plugin checks after resolving the current provider and tool', () => {
    renderHook(() => useToolSelector({ value: toolValue, onSelect: mockOnSelect }), {
      wrapper: queryClientWrapper,
    })

    expect(mockUsePluginInstalledCheck).toHaveBeenCalledWith({
      providerPluginId: 'org/test-plugin',
      enabled: false,
    })
  })

  it('should keep plugin checks enabled when the current tool cannot be resolved', () => {
    renderHook(
      () =>
        useToolSelector({
          value: { ...toolValue, tool_name: 'missing-tool' },
          onSelect: mockOnSelect,
        }),
      { wrapper: queryClientWrapper },
    )

    expect(mockUsePluginInstalledCheck).toHaveBeenCalledWith({
      providerPluginId: 'org/test-plugin',
      enabled: true,
    })
  })

  it('should keep marketplace fallback enabled after tool queries settle without resolving the provider', () => {
    renderHook(
      () =>
        useToolSelector({
          value: {
            ...toolValue,
            provider_name: 'org/market-plugin/search',
            plugin_id: 'org/market-plugin',
          },
          onSelect: mockOnSelect,
        }),
      { wrapper: queryClientWrapper },
    )

    expect(mockUsePluginInstalledCheck).toHaveBeenCalledWith({
      providerPluginId: 'org/market-plugin',
      enabled: true,
    })
  })

  it('should keep marketplace fallback enabled when legacy provider lists are still pending but plugin id is known', () => {
    queryClient.clear()

    renderHook(
      () =>
        useToolSelector({
          value: {
            ...toolValue,
            provider_name: 'org/market-plugin/search',
            plugin_id: 'org/market-plugin',
          },
          onSelect: mockOnSelect,
        }),
      { wrapper: queryClientWrapper },
    )

    expect(mockUsePluginInstalledCheck).toHaveBeenCalledWith({
      providerPluginId: 'org/market-plugin',
      enabled: true,
    })
  })

  it('should skip marketplace checks for unresolved non-plugin workflow tools', () => {
    renderHook(
      () =>
        useToolSelector({
          value: {
            ...toolValue,
            provider_name: 'author/tool-b',
            plugin_id: undefined,
            type: CollectionType.workflow,
          },
          onSelect: mockOnSelect,
        }),
      { wrapper: queryClientWrapper },
    )

    expect(mockUsePluginInstalledCheck).toHaveBeenCalledWith({
      providerPluginId: null,
      enabled: true,
    })
  })
})

vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  const pending = () => new Promise(() => {})
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'workspaces.current.tools.builtin.get': pending,
      'workspaces.current.tools.api.get': pending,
      'workspaces.current.tools.workflow.get': pending,
      'workspaces.current.tools.mcp.get': pending,
    }),
  }
})
