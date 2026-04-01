import type { LexicalEditor } from 'lexical'
import { LexicalComposer } from '@lexical/react/LexicalComposer'
import { act, render, waitFor } from '@testing-library/react'
import {
  BLUR_COMMAND,
  FOCUS_COMMAND,
} from 'lexical'
import OnBlurBlock from '../on-blur-or-focus-block'
import { CaptureEditorPlugin } from '../test-utils'

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

    it('should call onBlur when blur target is not var-search-input', async () => {
      const onBlur = vi.fn()
      const { getEditor } = renderOnBlurBlock({ onBlur })

      await waitFor(() => {
        expect(getEditor()).not.toBeNull()
      })

      const editor = getEditor()
      expect(editor).not.toBeNull()

      let handled = false
      act(() => {
        handled = editor!.dispatchCommand(BLUR_COMMAND, createBlurEvent(document.createElement('button')))
      })

      expect(handled).toBe(true)
      expect(onBlur).toHaveBeenCalledTimes(1)
    })

    it('should handle blur when onBlur callback is not provided', async () => {
      const { getEditor } = renderOnBlurBlock()

      await waitFor(() => {
        expect(getEditor()).not.toBeNull()
      })

      const editor = getEditor()
      expect(editor).not.toBeNull()

      let handled = false
      act(() => {
        handled = editor!.dispatchCommand(BLUR_COMMAND, createBlurEvent(document.createElement('div')))
      })

      expect(handled).toBe(true)
    })

    it('should skip onBlur when blur target is var-search-input', async () => {
      const onBlur = vi.fn()
      const { getEditor } = renderOnBlurBlock({ onBlur })

      await waitFor(() => {
        expect(getEditor()).not.toBeNull()
      })

      const editor = getEditor()
      expect(editor).not.toBeNull()

      const target = document.createElement('input')
      target.classList.add('var-search-input')

      let handled = false
      act(() => {
        handled = editor!.dispatchCommand(BLUR_COMMAND, createBlurEvent(target))
      })

      expect(handled).toBe(true)
      expect(onBlur).not.toHaveBeenCalled()
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
      act(() => {
        blurHandled = editor!.dispatchCommand(BLUR_COMMAND, createBlurEvent(document.createElement('div')))
        focusHandled = editor!.dispatchCommand(FOCUS_COMMAND, createFocusEvent())
      })

      expect(blurHandled).toBe(false)
      expect(focusHandled).toBe(false)
    })
  })
})
