import { render, screen } from '@testing-library/react'
import { CodeLanguage } from '@/app/components/workflow/nodes/code/types'
import { basePath } from '@/utils/var'
import CodeEditor from '..'

vi.mock('@/hooks/use-theme', () => ({
  default: () => ({ theme: 'light' }),
}))

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
