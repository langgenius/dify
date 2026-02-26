import type { LexicalEditor } from 'lexical'
import { LexicalComposer } from '@lexical/react/LexicalComposer'
import { act, render, waitFor } from '@testing-library/react'
import {
  BLUR_COMMAND,
  COMMAND_PRIORITY_EDITOR,
  FOCUS_COMMAND,
  KEY_ESCAPE_COMMAND,
} from 'lexical'
import OnBlurBlock from './on-blur-or-focus-block'
import { CaptureEditorPlugin } from './test-utils'
import { CLEAR_HIDE_MENU_TIMEOUT } from './workflow-variable-block'

const renderOnBlurBlock = (props?: {
  onBlur?: () => void
  onFocus?: () => void
}) => {
  let editor: LexicalEditor | null = null

  const setEditor = (value: LexicalEditor) => {
    editor = value
  }

  const utils = render(
    <LexicalComposer
      initialConfig={{
        namespace: 'on-blur-block-plugin-test',
        onError: (error: Error) => {
          throw error
        },
      }}
    >
      <OnBlurBlock onBlur={props?.onBlur} onFocus={props?.onFocus} />
      <CaptureEditorPlugin onReady={setEditor} />
    </LexicalComposer>,
  )

  return {
    ...utils,
    getEditor: () => editor,
  }
}

const createBlurEvent = (relatedTarget?: HTMLElement): FocusEvent => {
  return new FocusEvent('blur', { relatedTarget: relatedTarget ?? null })
}

const createFocusEvent = (): FocusEvent => {
  return new FocusEvent('focus')
}

describe('OnBlurBlock', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Focus and blur handling', () => {
    it('should call onFocus when focus command is dispatched', async () => {
      const onFocus = vi.fn()
      const { getEditor } = renderOnBlurBlock({ onFocus })

      await waitFor(() => {
        expect(getEditor()).not.toBeNull()
      })

      const editor = getEditor()
      expect(editor).not.toBeNull()

      let handled = false
      act(() => {
        handled = editor!.dispatchCommand(FOCUS_COMMAND, createFocusEvent())
      })

      expect(handled).toBe(true)
      expect(onFocus).toHaveBeenCalledTimes(1)
    })

    it('should call onBlur and dispatch escape after delay when blur target is not var-search-input', async () => {
      const onBlur = vi.fn()
      const { getEditor } = renderOnBlurBlock({ onBlur })

      await waitFor(() => {
        expect(getEditor()).not.toBeNull()
      })

      const editor = getEditor()
      expect(editor).not.toBeNull()
      vi.useFakeTimers()

      const onEscape = vi.fn(() => true)
      const unregister = editor!.registerCommand(
        KEY_ESCAPE_COMMAND,
        onEscape,
        COMMAND_PRIORITY_EDITOR,
      )

      let handled = false
      act(() => {
        handled = editor!.dispatchCommand(BLUR_COMMAND, createBlurEvent(document.createElement('button')))
      })

      expect(handled).toBe(true)
      expect(onBlur).toHaveBeenCalledTimes(1)
      expect(onEscape).not.toHaveBeenCalled()

      act(() => {
        vi.advanceTimersByTime(200)
      })

      expect(onEscape).toHaveBeenCalledTimes(1)
      unregister()
      vi.useRealTimers()
    })

    it('should dispatch delayed escape when onBlur callback is not provided', async () => {
      const { getEditor } = renderOnBlurBlock()

      await waitFor(() => {
        expect(getEditor()).not.toBeNull()
      })

      const editor = getEditor()
      expect(editor).not.toBeNull()
      vi.useFakeTimers()

      const onEscape = vi.fn(() => true)
      const unregister = editor!.registerCommand(
        KEY_ESCAPE_COMMAND,
        onEscape,
        COMMAND_PRIORITY_EDITOR,
      )

      act(() => {
        editor!.dispatchCommand(BLUR_COMMAND, createBlurEvent(document.createElement('div')))
      })
      act(() => {
        vi.advanceTimersByTime(200)
      })

      expect(onEscape).toHaveBeenCalledTimes(1)
      unregister()
      vi.useRealTimers()
    })

    it('should skip onBlur and delayed escape when blur target is var-search-input', async () => {
      const onBlur = vi.fn()
      const { getEditor } = renderOnBlurBlock({ onBlur })

      await waitFor(() => {
        expect(getEditor()).not.toBeNull()
      })

      const editor = getEditor()
      expect(editor).not.toBeNull()
      vi.useFakeTimers()

      const target = document.createElement('input')
      target.classList.add('var-search-input')

      const onEscape = vi.fn(() => true)
      const unregister = editor!.registerCommand(
        KEY_ESCAPE_COMMAND,
        onEscape,
        COMMAND_PRIORITY_EDITOR,
      )

      let handled = false
      act(() => {
        handled = editor!.dispatchCommand(BLUR_COMMAND, createBlurEvent(target))
      })
      act(() => {
        vi.advanceTimersByTime(200)
      })

      expect(handled).toBe(true)
      expect(onBlur).not.toHaveBeenCalled()
      expect(onEscape).not.toHaveBeenCalled()
      unregister()
      vi.useRealTimers()
    })

    it('should handle focus command when onFocus callback is not provided', async () => {
      const { getEditor } = renderOnBlurBlock()

      await waitFor(() => {
        expect(getEditor()).not.toBeNull()
      })

      const editor = getEditor()
      expect(editor).not.toBeNull()

      let handled = false
      act(() => {
        handled = editor!.dispatchCommand(FOCUS_COMMAND, createFocusEvent())
      })

      expect(handled).toBe(true)
    })
  })

  describe('Clear timeout command', () => {
    it('should clear scheduled escape timeout when clear command is dispatched', async () => {
      const { getEditor } = renderOnBlurBlock({ onBlur: vi.fn() })

      await waitFor(() => {
        expect(getEditor()).not.toBeNull()
      })

      const editor = getEditor()
      expect(editor).not.toBeNull()
      vi.useFakeTimers()

      const onEscape = vi.fn(() => true)
      const unregister = editor!.registerCommand(
        KEY_ESCAPE_COMMAND,
        onEscape,
        COMMAND_PRIORITY_EDITOR,
      )

      act(() => {
        editor!.dispatchCommand(BLUR_COMMAND, createBlurEvent(document.createElement('div')))
      })
      act(() => {
        editor!.dispatchCommand(CLEAR_HIDE_MENU_TIMEOUT, undefined)
      })
      act(() => {
        vi.advanceTimersByTime(200)
      })

      expect(onEscape).not.toHaveBeenCalled()
      unregister()
      vi.useRealTimers()
    })

    it('should handle clear command when no timeout is scheduled', async () => {
      const { getEditor } = renderOnBlurBlock()

      await waitFor(() => {
        expect(getEditor()).not.toBeNull()
      })

      const editor = getEditor()
      expect(editor).not.toBeNull()

      let handled = false
      act(() => {
        handled = editor!.dispatchCommand(CLEAR_HIDE_MENU_TIMEOUT, undefined)
      })

      expect(handled).toBe(true)
    })
  })

  describe('Lifecycle cleanup', () => {
    it('should unregister commands when component unmounts', async () => {
      const { getEditor, unmount } = renderOnBlurBlock()

      await waitFor(() => {
        expect(getEditor()).not.toBeNull()
      })

      const editor = getEditor()
      expect(editor).not.toBeNull()

      unmount()

      let blurHandled = true
      let focusHandled = true
      let clearHandled = true
      act(() => {
        blurHandled = editor!.dispatchCommand(BLUR_COMMAND, createBlurEvent(document.createElement('div')))
        focusHandled = editor!.dispatchCommand(FOCUS_COMMAND, createFocusEvent())
        clearHandled = editor!.dispatchCommand(CLEAR_HIDE_MENU_TIMEOUT, undefined)
      })

      expect(blurHandled).toBe(false)
      expect(focusHandled).toBe(false)
      expect(clearHandled).toBe(false)
    })
  })
})
