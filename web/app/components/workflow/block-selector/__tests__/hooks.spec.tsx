import { act, renderHook } from '@testing-library/react'
import { useTabs, useToolTabs } from '../hooks'
import { TabsEnum, ToolTypeEnum } from '../types'

describe('block-selector hooks', () => {
  it('falls back to the first valid tab when the preferred start tab is disabled', () => {
    const { result } = renderHook(() => useTabs({
      noStart: false,
      hasUserInputNode: true,
      defaultActiveTab: TabsEnum.Start,
    }))

    expect(result.current.tabs.find(tab => tab.key === TabsEnum.Start)?.disabled).toBe(true)
    expect(result.current.activeTab).toBe(TabsEnum.Blocks)
  })

  it('keeps the start tab enabled when forcing it on and resets to a valid tab after disabling blocks', () => {
    const props: Parameters<typeof useTabs>[0] = {
      noBlocks: false,
      noStart: false,
      hasUserInputNode: true,
      forceEnableStartTab: true,
    }

    const { result, rerender } = renderHook(nextProps => useTabs(nextProps), {
      initialProps: props,
    })

    expect(result.current.tabs.find(tab => tab.key === TabsEnum.Start)?.disabled).toBeFalsy()

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

    expect(visible.current.some(tab => tab.key === ToolTypeEnum.MCP)).toBe(true)
    expect(hidden.current.some(tab => tab.key === ToolTypeEnum.MCP)).toBe(false)
  })
})
