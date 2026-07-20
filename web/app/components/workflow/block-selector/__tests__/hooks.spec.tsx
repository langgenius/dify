import { renderHook } from '@testing-library/react'
import { useTabs, useToolTabs } from '../hooks'
import { TabType, ToolType } from '../types'

describe('block-selector hooks', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('keeps the start tab enabled when a configured user input start node exists', () => {
    const { result } = renderHook(() =>
      useTabs({
        noStart: false,
        defaultActiveTab: TabType.Start,
      }),
    )

    expect(result.current.tabs.find((tab) => tab.key === TabType.Start)?.disabled).toBeFalsy()
    expect(result.current.initialTab).toBe(TabType.Start)
  })

  it('disables the start tab when an unconfigured start placeholder exists', () => {
    const { result } = renderHook(() =>
      useTabs({
        noStart: false,
        hasStartPlaceholderNode: true,
        defaultActiveTab: TabType.Start,
      }),
    )

    const startTab = result.current.tabs.find((tab) => tab.key === TabType.Start)
    expect(startTab?.disabled).toBe(true)
    expect(startTab?.disabledTip).toBe('workflow.tabs.unconfiguredStartDisabledTip')
    expect(result.current.initialTab).toBe(TabType.Blocks)
  })

  it('chooses the enabled start panel when blocks, sources, and tools are unavailable', () => {
    const { result } = renderHook(() =>
      useTabs({
        noBlocks: true,
        noSources: true,
        noTools: true,
        noStart: false,
        forceEnableStartTab: true,
      }),
    )

    expect(result.current.tabs.find((tab) => tab.key === TabType.Start)?.disabled).toBeFalsy()
    expect(result.current.initialTab).toBe(TabType.Start)
  })

  it('returns the MCP tab only when it is not hidden', () => {
    const { result: visible } = renderHook(() => useToolTabs())
    const { result: hidden } = renderHook(() => useToolTabs(true))

    expect(visible.current.some((tab) => tab.key === ToolType.MCP)).toBe(true)
    expect(hidden.current.some((tab) => tab.key === ToolType.MCP)).toBe(false)
  })

  it('includes the snippets tab by default', () => {
    const { result } = renderHook(() => useTabs({}))

    expect(result.current.tabs.some((tab) => tab.key === TabType.Snippets)).toBe(true)
  })

  it('hides the snippets tab and falls back when snippets are disabled', () => {
    const { result } = renderHook(() =>
      useTabs({
        defaultActiveTab: TabType.Snippets,
        noSnippets: true,
      }),
    )

    expect(result.current.tabs.some((tab) => tab.key === TabType.Snippets)).toBe(false)
    expect(result.current.initialTab).toBe(TabType.Blocks)
  })
})
