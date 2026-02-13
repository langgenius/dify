import type * as React from 'react'
import type { ToolValue } from '@/app/components/workflow/block-selector/types'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useToolSelectorState } from '../use-tool-selector-state'

const mockToolParams = [
  { name: 'param1', form: 'llm', type: 'string', required: true, label: { en_US: 'Param 1' } },
  { name: 'param2', form: 'form', type: 'number', required: false, label: { en_US: 'Param 2' } },
]

const mockTools = [
  {
    id: 'test-provider',
    name: 'Test Provider',
    tools: [
      {
        name: 'test-tool',
        label: { en_US: 'Test Tool' },
        description: { en_US: 'A test tool' },
        parameters: mockToolParams,
      },
    ],
  },
]

vi.mock('@/service/use-tools', () => ({
  useAllBuiltInTools: () => ({ data: mockTools }),
  useAllCustomTools: () => ({ data: [] }),
  useAllWorkflowTools: () => ({ data: [] }),
  useAllMCPTools: () => ({ data: [] }),
  useInvalidateAllBuiltInTools: () => vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/service/use-plugins', () => ({
  useInvalidateInstalledPluginList: () => vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../use-plugin-installed-check', () => ({
  usePluginInstalledCheck: () => ({
    inMarketPlace: false,
    manifest: null,
    pluginID: '',
  }),
}))

vi.mock('@/utils/get-icon', () => ({
  getIconFromMarketPlace: () => '',
}))

vi.mock('@/app/components/tools/utils/to-form-schema', () => ({
  toolParametersToFormSchemas: (params: unknown[]) => (params as Record<string, unknown>[]).map(p => ({
    ...p,
    variable: p.name,
  })),
  generateFormValue: (value: Record<string, unknown>) => value || {},
  getPlainValue: (value: Record<string, unknown>) => value || {},
  getStructureValue: (value: Record<string, unknown>) => value || {},
}))

describe('useToolSelectorState', () => {
  const mockOnSelect = vi.fn()
  const _mockOnSelectMultiple = vi.fn()

  const toolValue: ToolValue = {
    provider_name: 'test-provider',
    provider_show_name: 'Test Provider',
    tool_name: 'test-tool',
    tool_label: 'Test Tool',
    tool_description: 'A test tool',
    settings: {},
    parameters: {},
    enabled: true,
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should initialize with default panel states', () => {
    const { result } = renderHook(() =>
      useToolSelectorState({ onSelect: mockOnSelect }),
    )

    expect(result.current.isShow).toBe(false)
    expect(result.current.isShowChooseTool).toBe(false)
    expect(result.current.currType).toBe('settings')
  })

  it('should find current provider from tool value', () => {
    const { result } = renderHook(() =>
      useToolSelectorState({ value: toolValue, onSelect: mockOnSelect }),
    )

    expect(result.current.currentProvider).toBeDefined()
    expect(result.current.currentProvider?.id).toBe('test-provider')
  })

  it('should find current tool from provider', () => {
    const { result } = renderHook(() =>
      useToolSelectorState({ value: toolValue, onSelect: mockOnSelect }),
    )

    expect(result.current.currentTool).toBeDefined()
    expect(result.current.currentTool?.name).toBe('test-tool')
  })

  it('should compute tool settings and params correctly', () => {
    const { result } = renderHook(() =>
      useToolSelectorState({ value: toolValue, onSelect: mockOnSelect }),
    )

    // param2 has form='form' (not 'llm'), so it goes to settings
    expect(result.current.currentToolSettings).toHaveLength(1)
    expect(result.current.currentToolSettings[0].name).toBe('param2')

    // param1 has form='llm', so it goes to params
    expect(result.current.currentToolParams).toHaveLength(1)
    expect(result.current.currentToolParams[0].name).toBe('param1')
  })

  it('should show tab slider when both settings and params exist', () => {
    const { result } = renderHook(() =>
      useToolSelectorState({ value: toolValue, onSelect: mockOnSelect }),
    )

    expect(result.current.showTabSlider).toBe(true)
    expect(result.current.userSettingsOnly).toBe(false)
    expect(result.current.reasoningConfigOnly).toBe(false)
  })

  it('should toggle panel visibility', () => {
    const { result } = renderHook(() =>
      useToolSelectorState({ onSelect: mockOnSelect }),
    )

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
    const { result } = renderHook(() =>
      useToolSelectorState({ onSelect: mockOnSelect }),
    )

    act(() => {
      result.current.setCurrType('params')
    })
    expect(result.current.currType).toBe('params')
  })

  it('should handle description change', () => {
    const { result } = renderHook(() =>
      useToolSelectorState({ value: toolValue, onSelect: mockOnSelect }),
    )

    const event = { target: { value: 'New description' } } as React.ChangeEvent<HTMLTextAreaElement>
    act(() => {
      result.current.handleDescriptionChange(event)
    })

    expect(mockOnSelect).toHaveBeenCalledWith(expect.objectContaining({
      extra: expect.objectContaining({ description: 'New description' }),
    }))
  })

  it('should handle enabled change', () => {
    const { result } = renderHook(() =>
      useToolSelectorState({ value: toolValue, onSelect: mockOnSelect }),
    )

    act(() => {
      result.current.handleEnabledChange(false)
    })

    expect(mockOnSelect).toHaveBeenCalledWith(expect.objectContaining({
      enabled: false,
    }))
  })

  it('should handle authorization item click', () => {
    const { result } = renderHook(() =>
      useToolSelectorState({ value: toolValue, onSelect: mockOnSelect }),
    )

    act(() => {
      result.current.handleAuthorizationItemClick('cred-123')
    })

    expect(mockOnSelect).toHaveBeenCalledWith(expect.objectContaining({
      credential_id: 'cred-123',
    }))
  })

  it('should not call onSelect if value is undefined', () => {
    const { result } = renderHook(() =>
      useToolSelectorState({ onSelect: mockOnSelect }),
    )

    act(() => {
      result.current.handleEnabledChange(true)
    })
    expect(mockOnSelect).not.toHaveBeenCalled()
  })

  it('should return empty arrays when no provider matches', () => {
    const { result } = renderHook(() =>
      useToolSelectorState({
        value: { ...toolValue, provider_name: 'nonexistent' },
        onSelect: mockOnSelect,
      }),
    )

    expect(result.current.currentProvider).toBeUndefined()
    expect(result.current.currentTool).toBeUndefined()
    expect(result.current.currentToolSettings).toEqual([])
    expect(result.current.currentToolParams).toEqual([])
  })
})
