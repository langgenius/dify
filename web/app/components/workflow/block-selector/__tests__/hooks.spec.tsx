import { act, renderHook } from '@testing-library/react'
import { useTabs, useToolTabs } from '../hooks'
import { TabsEnum, ToolTypeEnum } from '../types'

describe('block-selector hooks', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('keeps the start tab enabled when a configured user input start node exists', () => {
    const { result } = renderHook(() =>
      useTabs({
        noStart: false,
        defaultActiveTab: TabsEnum.Start,
      }),
    )

    expect(result.current.tabs.find((tab) => tab.key === TabsEnum.Start)?.disabled).toBeFalsy()
    expect(result.current.activeTab).toBe(TabsEnum.Start)
  })

  it('disables the start tab when an unconfigured start placeholder exists', () => {
    const { result } = renderHook(() =>
      useTabs({
        noStart: false,
        hasStartPlaceholderNode: true,
        defaultActiveTab: TabsEnum.Start,
      }),
    )

    const startTab = result.current.tabs.find((tab) => tab.key === TabsEnum.Start)
    expect(startTab?.disabled).toBe(true)
    expect(startTab?.disabledTip).toBe('workflow.tabs.unconfiguredStartDisabledTip')
    expect(startTab?.disabledTipLinkKey).toBe('startNodesDocs')
    expect(result.current.activeTab).toBe(TabsEnum.Blocks)
  })

  it('keeps the start tab enabled when forcing it on and resets to a valid tab after disabling blocks', () => {
    const props: Parameters<typeof useTabs>[0] = {
      noBlocks: false,
      noStart: false,
      forceEnableStartTab: true,
    }

    const { result, rerender } = renderHook((nextProps) => useTabs(nextProps), {
      initialProps: props,
    })

    expect(result.current.tabs.find((tab) => tab.key === TabsEnum.Start)?.disabled).toBeFalsy()

    act(() => {
      result.current.setActiveTab(TabsEnum.Blocks)
    })

    rerender({
      ...props,
      noBlocks: true,
      noSources: true,
      noTools: true,
    })

    expect(result.current.activeTab).toBe(TabsEnum.Start)
  })

  it('returns the MCP tab only when it is not hidden', () => {
    const { result: visible } = renderHook(() => useToolTabs())
    const { result: hidden } = renderHook(() => useToolTabs(true))

    expect(visible.current.some((tab) => tab.key === ToolTypeEnum.MCP)).toBe(true)
    expect(hidden.current.some((tab) => tab.key === ToolTypeEnum.MCP)).toBe(false)
  })

  it('includes the snippets tab by default', () => {
    const { result } = renderHook(() => useTabs({}))

    expect(result.current.tabs.some((tab) => tab.key === TabsEnum.Snippets)).toBe(true)
  })

  it('hides the snippets tab and falls back when snippets are disabled', () => {
    const { result } = renderHook(() =>
      useTabs({
        defaultActiveTab: TabsEnum.Snippets,
        noSnippets: true,
      }),
    )

    expect(result.current.tabs.some((tab) => tab.key === TabsEnum.Snippets)).toBe(false)
    expect(result.current.activeTab).toBe(TabsEnum.Blocks)
  })

  it('resets the active tab to the current default tab', () => {
    const { result } = renderHook(() =>
      useTabs({
        noStart: false,
      }),
    )

    act(() => {
      result.current.setActiveTab(TabsEnum.Start)
    })

    expect(result.current.activeTab).toBe(TabsEnum.Start)

    act(() => {
      result.current.resetActiveTab()
    })

    expect(result.current.activeTab).toBe(TabsEnum.Blocks)
  })
})
