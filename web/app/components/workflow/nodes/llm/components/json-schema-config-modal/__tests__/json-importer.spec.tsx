import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { JSON_SCHEMA_MAX_DEPTH } from '@/config'
import JsonImporter from '../json-importer'

const mockEmit = vi.fn()
const mockCheckJsonDepth = vi.fn()
const visualEditorState = {
  advancedEditing: false,
  isAddingNewField: false,
}

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

vi.mock('../visual-editor/context', () => ({
  useMittContext: () => ({
    emit: mockEmit,
  }),
}))

vi.mock('../visual-editor/store', () => ({
  useVisualEditorStore: (selector: (state: typeof visualEditorState) => unknown) => selector(visualEditorState),
}))

vi.mock('../../../utils', () => ({
  checkJsonDepth: (...args: unknown[]) => mockCheckJsonDepth(...args),
}))

vi.mock('../code-editor', () => ({
  default: ({
    value,
    onUpdate,
  }: {
    value: string
    onUpdate: (value: string) => void
  }) => (
    <textarea
      aria-label="json-editor"
      value={value}
      onChange={e => onUpdate(e.target.value)}
    />
  ),
}))

vi.mock('../error-message', () => ({
  default: ({ message }: { message: string }) => <div data-testid="error-message">{message}</div>,
}))

vi.mock('@/app/components/base/ui/popover', async () => {
  const ReactModule = await vi.importActual<typeof import('react')>('react')

  const PopoverContext = ReactModule.createContext<{
    open: boolean
    onOpenChange?: (open: boolean) => void
  } | null>(null)

  const PopoverTrigger = ReactModule.forwardRef<HTMLButtonElement, React.ButtonHTMLAttributes<HTMLButtonElement>>(
    ({ children, onClick, ...props }, ref) => {
      const context = ReactModule.useContext(PopoverContext)

      return (
        <button
          ref={ref}
          type="button"
          {...props}
          onClick={(event) => {
            onClick?.(event)
            context?.onOpenChange?.(!context.open)
          }}
        >
          {children}
        </button>
      )
    },
  )

  PopoverTrigger.displayName = 'PopoverTrigger'

  return {
    Popover: ({
      children,
      open,
      onOpenChange,
    }: {
      children: React.ReactNode
      open: boolean
      onOpenChange?: (open: boolean) => void
    }) => (
      <PopoverContext.Provider value={{ open, onOpenChange }}>
        {children}
      </PopoverContext.Provider>
    ),
    PopoverTrigger,
    PopoverContent: ({ children }: { children: React.ReactNode }) => {
      const context = ReactModule.useContext(PopoverContext)
      if (!context?.open)
        return null

      return <div data-testid="popover-content">{children}</div>
    },
  }
})

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
    mockCheckJsonDepth.mockReturnValue(1)
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

    render(
      <JsonImporter
        onSubmit={mockOnSubmit}
        updateBtnWidth={mockUpdateBtnWidth}
      />,
    )

    expect(mockUpdateBtnWidth).toHaveBeenCalledWith(88)

    await user.click(screen.getByRole('button', { name: 'nodes.llm.jsonSchema.import' }))

    expect(screen.getByTestId('popover-content')).toBeInTheDocument()
    expect(mockEmit).not.toHaveBeenCalled()
  })

  it('emits quitEditing when opening while advanced editing is active', async () => {
    visualEditorState.advancedEditing = true
    const user = userEvent.setup()

    render(
      <JsonImporter
        onSubmit={mockOnSubmit}
        updateBtnWidth={mockUpdateBtnWidth}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'nodes.llm.jsonSchema.import' }))

    expect(mockEmit).toHaveBeenCalledWith('quitEditing', {})
  })

  it('shows a parse error when the root value is not an object', async () => {
    const user = userEvent.setup()

    render(
      <JsonImporter
        onSubmit={mockOnSubmit}
        updateBtnWidth={mockUpdateBtnWidth}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'nodes.llm.jsonSchema.import' }))
    fireEvent.change(screen.getByLabelText('json-editor'), { target: { value: '[]' } })
    await user.click(screen.getByRole('button', { name: 'operation.submit' }))

    expect(screen.getByTestId('error-message')).toHaveTextContent('Root must be an object, not an array or primitive value.')
    expect(mockOnSubmit).not.toHaveBeenCalled()
  })

  it('shows a depth error when the schema exceeds the configured maximum', async () => {
    mockCheckJsonDepth.mockReturnValue(JSON_SCHEMA_MAX_DEPTH + 1)
    const user = userEvent.setup()

    render(
      <JsonImporter
        onSubmit={mockOnSubmit}
        updateBtnWidth={mockUpdateBtnWidth}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'nodes.llm.jsonSchema.import' }))
    fireEvent.change(screen.getByLabelText('json-editor'), { target: { value: '{"foo":{"bar":1}}' } })
    await user.click(screen.getByRole('button', { name: 'operation.submit' }))

    expect(screen.getByTestId('error-message')).toHaveTextContent(`Schema exceeds maximum depth of ${JSON_SCHEMA_MAX_DEPTH}.`)
    expect(mockOnSubmit).not.toHaveBeenCalled()
  })

  it('shows the parser error when JSON.parse throws an Error', async () => {
    const user = userEvent.setup()
    const parseSpy = vi.spyOn(JSON, 'parse').mockImplementationOnce(() => {
      throw new Error('Malformed JSON payload')
    })

    render(
      <JsonImporter
        onSubmit={mockOnSubmit}
        updateBtnWidth={mockUpdateBtnWidth}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'nodes.llm.jsonSchema.import' }))
    fireEvent.change(screen.getByLabelText('json-editor'), { target: { value: '{"foo":1}' } })
    await user.click(screen.getByRole('button', { name: 'operation.submit' }))

    expect(screen.getByTestId('error-message')).toHaveTextContent('Malformed JSON payload')
    expect(mockOnSubmit).not.toHaveBeenCalled()

    parseSpy.mockRestore()
  })

  it('falls back to the default invalid JSON message when JSON.parse throws a non-Error value', async () => {
    const user = userEvent.setup()
    const parseSpy = vi.spyOn(JSON, 'parse').mockImplementationOnce(() => throwUnknown(Object.create(null)))

    render(
      <JsonImporter
        onSubmit={mockOnSubmit}
        updateBtnWidth={mockUpdateBtnWidth}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'nodes.llm.jsonSchema.import' }))
    fireEvent.change(screen.getByLabelText('json-editor'), { target: { value: '{"foo":1}' } })
    await user.click(screen.getByRole('button', { name: 'operation.submit' }))

    expect(screen.getByTestId('error-message')).toHaveTextContent('Invalid JSON')
    expect(mockOnSubmit).not.toHaveBeenCalled()

    parseSpy.mockRestore()
  })

  it('submits valid JSON and closes the popover from footer actions', async () => {
    const user = userEvent.setup()

    render(
      <JsonImporter
        onSubmit={mockOnSubmit}
        updateBtnWidth={mockUpdateBtnWidth}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'nodes.llm.jsonSchema.import' }))
    fireEvent.change(screen.getByLabelText('json-editor'), { target: { value: '{"foo":"bar"}' } })
    await user.click(screen.getByRole('button', { name: 'operation.submit' }))

    expect(mockOnSubmit).toHaveBeenCalledWith({ foo: 'bar' })
    expect(screen.queryByTestId('popover-content')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'nodes.llm.jsonSchema.import' }))
    await user.click(screen.getByRole('button', { name: 'operation.cancel' }))

    expect(screen.queryByTestId('popover-content')).not.toBeInTheDocument()
  })
})
