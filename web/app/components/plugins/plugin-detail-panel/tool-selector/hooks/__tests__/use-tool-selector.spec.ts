import type { ToolValue } from '@/app/components/workflow/block-selector/types'
import { act, renderHook, waitFor } from '@testing-library/react'
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

const requests = vi.hoisted(() => ({ installed: vi.fn(), marketplace: vi.fn() }))
vi.mock('@/service/base', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/service/base')>()),
  getMarketplace: requests.marketplace,
}))

describe('useToolSelector', () => {
  const mockOnSelect = vi.fn()

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
    requests.installed.mockResolvedValue({ plugins: [] })
    requests.marketplace.mockResolvedValue({ data: { plugin: { name: 'Marketplace tool' } } })
  })

  it('should compute tool settings and params correctly', () => {
    const { result } = renderHook(
      () => useToolSelector({ value: toolValue, onSelect: mockOnSelect }),
      { wrapper: queryClientWrapper },
    )

    expect(result.current.currentProvider?.id).toBe('test-provider')
    expect(result.current.currentTool?.name).toBe('test-tool')
    expect(result.current.showTabSlider).toBe(true)
    expect(result.current.userSettingsOnly).toBe(false)
    expect(result.current.reasoningConfigOnly).toBe(false)

    // Only form parameters belong to user settings.
    expect(result.current.currentToolSettings).toHaveLength(1)
    expect(result.current.settingsFormSchemas[0]!.variable).toBe('param2')

    // param1 has form='llm', so it goes to params
    expect(result.current.currentToolParams).toHaveLength(1)
    expect(result.current.paramsFormSchemas[0]).toEqual(
      expect.objectContaining({ variable: 'param1', type: 'text-input', required: true }),
    )
  })

  it.each([
    ['description', { extra: { description: 'New description' } }],
    ['enabled', { enabled: false }],
    ['credential', { credential_id: 'cred-123' }],
  ] as const)('updates %s while preserving the selected tool configuration', (field, changed) => {
    const value = { ...toolValue, settings: { param2: { type: 'constant', value: 42 } } }
    const { result } = renderHook(() => useToolSelector({ value, onSelect: mockOnSelect }), {
      wrapper: queryClientWrapper,
    })
    act(() => {
      if (field === 'description') result.current.handleDescriptionChange('New description')
      if (field === 'enabled') result.current.handleEnabledChange(false)
      if (field === 'credential') result.current.handleAuthorizationItemClick('cred-123')
    })
    expect(mockOnSelect).toHaveBeenCalledExactlyOnceWith({ ...value, ...changed })
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

  it('does not request marketplace data for a resolved provider and tool', () => {
    renderHook(() => useToolSelector({ value: toolValue, onSelect: mockOnSelect }), {
      wrapper: queryClientWrapper,
    })
    expect(requests.installed).not.toHaveBeenCalled()
    expect(requests.marketplace).not.toHaveBeenCalled()
  })

  it.each([
    ['missing tool', { ...toolValue, tool_name: 'missing-tool' }, 'org/test-plugin'],
    [
      'missing provider',
      { ...toolValue, provider_name: 'org/market-plugin/search', plugin_id: 'org/market-plugin' },
      'org/market-plugin',
    ],
  ] as const)('resolves marketplace metadata for a %s', async (_reason, value, pluginId) => {
    const { result } = renderHook(() => useToolSelector({ value, onSelect: mockOnSelect }), {
      wrapper: queryClientWrapper,
    })
    await waitFor(() => expect(result.current.inMarketPlace).toBe(true))
    expect(result.current.manifest).toMatchObject({ name: 'Marketplace tool' })
    expect(requests.installed).toHaveBeenCalledWith({ body: { plugin_ids: [pluginId] } })
    expect(requests.marketplace).toHaveBeenCalledWith(`/plugins/${pluginId}`)
  })

  it('fetches the known plugin while legacy provider lists are still pending', async () => {
    queryClient.clear()
    const { result } = renderHook(
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
    await waitFor(() => expect(result.current.inMarketPlace).toBe(true))
    expect(requests.installed).toHaveBeenCalledWith({ body: { plugin_ids: ['org/market-plugin'] } })
    expect(requests.marketplace).toHaveBeenCalledWith('/plugins/org/market-plugin')
  })

  it('does not request marketplace data for an unresolved workflow tool', () => {
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
    expect(requests.installed).not.toHaveBeenCalled()
    expect(requests.marketplace).not.toHaveBeenCalled()
  })
})

vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  const pending = () => new Promise(() => {})
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'workspaces.current.plugin.list.installations.ids.post': requests.installed,
      'workspaces.current.tools.builtin.get': pending,
      'workspaces.current.tools.api.get': pending,
      'workspaces.current.tools.workflow.get': pending,
      'workspaces.current.tools.mcp.get': pending,
    }),
  }
})
