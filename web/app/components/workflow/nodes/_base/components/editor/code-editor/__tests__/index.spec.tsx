import { render, screen } from '@testing-library/react'
import { CodeLanguage } from '@/app/components/workflow/nodes/code/types'
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
