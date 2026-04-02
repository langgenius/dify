import type { LexicalEditor } from 'lexical'
import { act, renderHook } from '@testing-library/react'
import {
  BLUR_COMMAND,
  COMMAND_PRIORITY_EDITOR,
  FOCUS_COMMAND,
} from 'lexical'
import { useEditorBlur } from '../use-editor-blur'

describe('useEditorBlur', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('should register blur and focus handlers and toggle visibility state', () => {
    const blurUnregister = vi.fn()
    const focusUnregister = vi.fn()
    const registerCommand = vi
      .fn()
      .mockReturnValueOnce(blurUnregister)
      .mockReturnValueOnce(focusUnregister)
    const editor = {
      registerCommand,
    } as unknown as LexicalEditor

    const { result, unmount } = renderHook(() => useEditorBlur(editor))

    expect(result.current.blurHidden).toBe(false)
    expect(registerCommand).toHaveBeenNthCalledWith(
      1,
      BLUR_COMMAND,
      expect.any(Function),
      COMMAND_PRIORITY_EDITOR,
    )
    expect(registerCommand).toHaveBeenNthCalledWith(
      2,
      FOCUS_COMMAND,
      expect.any(Function),
      COMMAND_PRIORITY_EDITOR,
    )

    const blurHandler = registerCommand.mock.calls[0][1] as () => boolean
    const focusHandler = registerCommand.mock.calls[1][1] as () => boolean

    act(() => {
      expect(blurHandler()).toBe(false)
      vi.advanceTimersByTime(199)
    })
    expect(result.current.blurHidden).toBe(false)

    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(result.current.blurHidden).toBe(true)

    act(() => {
      expect(focusHandler()).toBe(false)
    })
    expect(result.current.blurHidden).toBe(false)

    act(() => {
      blurHandler()
    })
    unmount()

    expect(blurUnregister).toHaveBeenCalledTimes(1)
    expect(focusUnregister).toHaveBeenCalledTimes(1)
  })
})
