import type { OnMount } from '@monaco-editor/react'
import { fireEvent, render, screen } from '@testing-library/react'
import { assert } from 'vite-plus/test'
import { CodeLanguage } from '@/app/components/workflow/nodes/code/types'
import { basePath } from '@/utils/var'
import CodeEditor from '..'

const jsonObjectSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    name: { type: 'string' },
  },
  required: ['id', 'name'],
}

describe('CodeEditor', () => {
  it('serializes object JSON values so Monaco receives text instead of a buffer factory', () => {
    render(<CodeEditor language={CodeLanguage.json} value={jsonObjectSchema} noWrapper />)

    expect(screen.getByTestId('monaco-editor')).toHaveValue(
      JSON.stringify(jsonObjectSchema, null, 2),
    )
  })

  it('does not measure content after the editor unmounts with a resize pending', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      const onMount = vi.fn<OnMount>()
      const onChange = vi.fn()
      const { unmount } = render(
        <CodeEditor
          language={CodeLanguage.json}
          value={jsonObjectSchema}
          onMount={onMount}
          onChange={onChange}
          noWrapper
        />,
      )
      const editor = onMount.mock.lastCall?.[0]
      assert(editor)
      const getContentHeight = vi.spyOn(editor, 'getContentHeight')

      // Deliver Monaco's change event without advancing the resize timer.
      fireEvent.change(screen.getByTestId('monaco-editor'), { target: { value: '' } })
      expect(onChange).toHaveBeenCalledWith('')

      unmount()
      getContentHeight.mockClear()
      vi.runOnlyPendingTimers()

      expect(getContentHeight).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('MonacoEnvironment', () => {
  it('returns the worker URL without appending the worker label as a fragment', () => {
    const getWorkerUrl = window.MonacoEnvironment?.getWorkerUrl

    expect(getWorkerUrl).toBeTypeOf('function')

    const workerUrl = getWorkerUrl?.('workerMain.js', 'editorWorkerService')

    // Without this configuration Monaco appends `#<label>` to the worker URL, which
    // browsers encode to `%23` and turn into a 404 on the worker entry point.
    expect(workerUrl).not.toContain('#')
    expect(workerUrl).toBe(`${window.location.origin}${basePath}/vs/base/worker/workerMain.js`)
  })
})
