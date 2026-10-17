import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { JSON_SCHEMA_MAX_DEPTH } from '@/config'
import JsonImporter from '../json-importer'

const mockEmit = vi.fn()
const visualEditorState = {
  advancedEditing: false,
  isAddingNewField: false,
}
vi.mock('../visual-editor/context', () => ({
  useMittContext: () => ({
    emit: mockEmit,
  }),
}))

vi.mock('../visual-editor/store', () => ({
  useVisualEditorStore: (selector: (state: typeof visualEditorState) => unknown) =>
    selector(visualEditorState),
}))

vi.mock('../code-editor', () => ({
  default: ({ value, onUpdate }: { value: string; onUpdate: (value: string) => void }) => (
    <textarea aria-label="json-editor" value={value} onChange={(e) => onUpdate(e.target.value)} />
  ),
}))

vi.mock('../error-message', () => ({
  default: ({ message }: { message: string }) => <div data-testid="error-message">{message}</div>,
}))

const buildNestedObject = (levels: number): Record<string, unknown> => {
  let node: Record<string, unknown> = { value: 'leaf' }
  for (let i = 1; i < levels; i += 1) node = { child: node }
  return node
}

const buildArrayWrappedExample = (schemaDepth: number): Record<string, unknown> => {
  let node: Record<string, unknown> = { value: 'leaf' }
  for (let i = 1; i < schemaDepth - 2; i += 1) node = { child: node }
  return { rows: [node] }
}

describe('JsonImporter', () => {
  const mockOnSubmit = vi.fn()
  const mockUpdateBtnWidth = vi.fn()
  const throwUnknown = (error: unknown): never => {
    throw error
  }

  beforeEach(() => {
    vi.clearAllMocks()
    visualEditorState.advancedEditing = false
    visualEditorState.isAddingNewField = false
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      width: 88,
      height: 32,
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('measures the trigger width and opens the importer without quitting editing by default', async () => {
    const user = userEvent.setup()

    render(<JsonImporter onSubmit={mockOnSubmit} updateBtnWidth={mockUpdateBtnWidth} />)

    expect(mockUpdateBtnWidth).toHaveBeenCalledWith(88)

    await user.click(
      screen.getByRole('button', { name: /(?:^|\.)nodes\.llm\.jsonSchema\.import(?=$|:)/ }),
    )

    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(mockEmit).not.toHaveBeenCalled()
  })

  it('emits quitEditing when opening while advanced editing is active', async () => {
    visualEditorState.advancedEditing = true
    const user = userEvent.setup()

    render(<JsonImporter onSubmit={mockOnSubmit} updateBtnWidth={mockUpdateBtnWidth} />)

    await user.click(
      screen.getByRole('button', { name: /(?:^|\.)nodes\.llm\.jsonSchema\.import(?=$|:)/ }),
    )

    expect(mockEmit).toHaveBeenCalledWith('quitEditing', {})
  })

  it('shows a parse error when the root value is not an object', async () => {
    const user = userEvent.setup()

    render(<JsonImporter onSubmit={mockOnSubmit} updateBtnWidth={mockUpdateBtnWidth} />)

    await user.click(
      screen.getByRole('button', { name: /(?:^|\.)nodes\.llm\.jsonSchema\.import(?=$|:)/ }),
    )
    fireEvent.change(screen.getByLabelText('json-editor'), { target: { value: '[]' } })
    await user.click(screen.getByRole('button', { name: /(?:^|\.)operation\.submit(?=$|:)/ }))

    expect(screen.getByTestId('error-message')).toHaveTextContent(
      'Root must be an object, not an array or primitive value.',
    )
    expect(mockOnSubmit).not.toHaveBeenCalled()
  })

  it('shows a depth error when the converted schema exceeds the configured maximum', async () => {
    const user = userEvent.setup()

    render(<JsonImporter onSubmit={mockOnSubmit} updateBtnWidth={mockUpdateBtnWidth} />)

    await user.click(
      screen.getByRole('button', { name: /(?:^|\.)nodes\.llm\.jsonSchema\.import(?=$|:)/ }),
    )
    fireEvent.change(screen.getByLabelText('json-editor'), {
      target: { value: JSON.stringify(buildNestedObject(JSON_SCHEMA_MAX_DEPTH + 1)) },
    })
    await user.click(screen.getByRole('button', { name: /(?:^|\.)operation\.submit(?=$|:)/ }))

    expect(screen.getByTestId('error-message')).toHaveTextContent(
      `Schema exceeds maximum depth of ${JSON_SCHEMA_MAX_DEPTH}.`,
    )
    expect(mockOnSubmit).not.toHaveBeenCalled()
  })

  it('rejects an example whose generated schema exceeds the maximum depth even though the raw example passes a shallow check', async () => {
    const user = userEvent.setup()

    render(<JsonImporter onSubmit={mockOnSubmit} updateBtnWidth={mockUpdateBtnWidth} />)

    await user.click(
      screen.getByRole('button', { name: /(?:^|\.)nodes\.llm\.jsonSchema\.import(?=$|:)/ }),
    )
    fireEvent.change(screen.getByLabelText('json-editor'), {
      target: { value: JSON.stringify(buildArrayWrappedExample(JSON_SCHEMA_MAX_DEPTH + 1)) },
    })
    await user.click(screen.getByRole('button', { name: /(?:^|\.)operation\.submit(?=$|:)/ }))

    expect(screen.getByTestId('error-message')).toHaveTextContent(
      `Schema exceeds maximum depth of ${JSON_SCHEMA_MAX_DEPTH}.`,
    )
    expect(mockOnSubmit).not.toHaveBeenCalled()
  })

  it('accepts an example whose generated schema is exactly at the maximum depth', async () => {
    const user = userEvent.setup()

    render(<JsonImporter onSubmit={mockOnSubmit} updateBtnWidth={mockUpdateBtnWidth} />)

    await user.click(
      screen.getByRole('button', { name: /(?:^|\.)nodes\.llm\.jsonSchema\.import(?=$|:)/ }),
    )
    fireEvent.change(screen.getByLabelText('json-editor'), {
      target: { value: JSON.stringify(buildNestedObject(JSON_SCHEMA_MAX_DEPTH)) },
    })
    await user.click(screen.getByRole('button', { name: /(?:^|\.)operation\.submit(?=$|:)/ }))

    expect(screen.queryByTestId('error-message')).not.toBeInTheDocument()
    expect(mockOnSubmit).toHaveBeenCalledTimes(1)
  })

  it('shows the parser error when JSON.parse throws an Error', async () => {
    const user = userEvent.setup()
    render(<JsonImporter onSubmit={mockOnSubmit} updateBtnWidth={mockUpdateBtnWidth} />)

    await user.click(
      screen.getByRole('button', { name: /(?:^|\.)nodes\.llm\.jsonSchema\.import(?=$|:)/ }),
    )
    fireEvent.change(screen.getByLabelText('json-editor'), { target: { value: '{"foo":1}' } })
    const parseSpy = vi.spyOn(JSON, 'parse').mockImplementation(() => {
      throw new Error('Malformed JSON payload')
    })
    await user.click(screen.getByRole('button', { name: /(?:^|\.)operation\.submit(?=$|:)/ }))

    expect(screen.getByTestId('error-message')).toHaveTextContent('Malformed JSON payload')
    expect(mockOnSubmit).not.toHaveBeenCalled()

    parseSpy.mockRestore()
  })

  it('falls back to the default invalid JSON message when JSON.parse throws a non-Error value', async () => {
    const user = userEvent.setup()
    render(<JsonImporter onSubmit={mockOnSubmit} updateBtnWidth={mockUpdateBtnWidth} />)

    await user.click(
      screen.getByRole('button', { name: /(?:^|\.)nodes\.llm\.jsonSchema\.import(?=$|:)/ }),
    )
    fireEvent.change(screen.getByLabelText('json-editor'), { target: { value: '{"foo":1}' } })
    const parseSpy = vi
      .spyOn(JSON, 'parse')
      .mockImplementation(() => throwUnknown(Object.create(null)))
    await user.click(screen.getByRole('button', { name: /(?:^|\.)operation\.submit(?=$|:)/ }))

    expect(screen.getByTestId('error-message')).toHaveTextContent('Invalid JSON')
    expect(mockOnSubmit).not.toHaveBeenCalled()

    parseSpy.mockRestore()
  })

  it('submits valid JSON and closes the popover from footer actions', async () => {
    const user = userEvent.setup()

    render(<JsonImporter onSubmit={mockOnSubmit} updateBtnWidth={mockUpdateBtnWidth} />)

    await user.click(
      screen.getByRole('button', { name: /(?:^|\.)nodes\.llm\.jsonSchema\.import(?=$|:)/ }),
    )
    fireEvent.change(screen.getByLabelText('json-editor'), { target: { value: '{"foo":"bar"}' } })
    await user.click(screen.getByRole('button', { name: /(?:^|\.)operation\.submit(?=$|:)/ }))

    expect(mockOnSubmit).toHaveBeenCalledWith({ foo: 'bar' })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    await user.click(
      screen.getByRole('button', { name: /(?:^|\.)nodes\.llm\.jsonSchema\.import(?=$|:)/ }),
    )
    await user.click(screen.getByRole('button', { name: /(?:^|\.)operation\.cancel(?=$|:)/ }))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
