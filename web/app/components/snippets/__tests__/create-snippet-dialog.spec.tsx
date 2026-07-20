import type { SnippetCanvasData, SnippetInputField } from '@/models/snippet'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PipelineInputVarType } from '@/models/pipeline'
import { expectLoadingButton } from '@/test/button'
import { CreateSnippetDialog } from '../create-snippet-dialog'

let capturedKeyPressHandler: (() => void) | undefined
let capturedHotkey: string | undefined
let capturedHotkeyOptions:
  | {
      enabled?: boolean
      ignoreInputs?: boolean
      preventDefault?: boolean
      stopPropagation?: boolean
      target?: React.RefObject<HTMLElement | null>
    }
  | undefined

vi.mock('@tanstack/react-hotkeys', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-hotkeys')>()
  return {
    ...actual,
    useHotkey: (
      hotkey: string,
      handler: () => void,
      options?: {
        enabled?: boolean
        ignoreInputs?: boolean
        preventDefault?: boolean
        stopPropagation?: boolean
        target?: React.RefObject<HTMLElement | null>
      },
    ) => {
      capturedHotkey = hotkey
      capturedKeyPressHandler = () => {
        if (options?.enabled !== false) handler()
      }
      capturedHotkeyOptions = options
    },
  }
})

const selectedGraph: SnippetCanvasData = {
  nodes: [],
  edges: [],
  viewport: { x: 12, y: 24, zoom: 0.8 },
}

const inputFields: SnippetInputField[] = [
  {
    label: 'topic',
    variable: 'topic',
    type: PipelineInputVarType.textInput,
    required: true,
  },
]

describe('CreateSnippetDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    capturedKeyPressHandler = undefined
    capturedHotkey = undefined
    capturedHotkeyOptions = undefined
  })

  it('should submit trimmed snippet values with the selected graph and input fields', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    const onConfirm = vi.fn()

    render(
      <CreateSnippetDialog
        isOpen
        selectedGraph={selectedGraph}
        inputFields={inputFields}
        onClose={onClose}
        onConfirm={onConfirm}
      />,
    )

    await user.type(
      screen.getByPlaceholderText('workflow.snippet.namePlaceholder'),
      '  Support snippet  ',
    )
    await user.type(
      screen.getByPlaceholderText('workflow.snippet.descriptionPlaceholder'),
      '  Helps agents  ',
    )
    await user.click(screen.getByRole('button', { name: 'workflow.snippet.confirm' }))

    expect(onConfirm).toHaveBeenCalledWith({
      name: 'Support snippet',
      description: 'Helps agents',
      graph: selectedGraph,
      input_fields: inputFields,
    })
    expect(onClose).not.toHaveBeenCalled()
  })

  it('should disable confirm for blank names and reset fields when cancelled', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()

    render(
      <CreateSnippetDialog
        isOpen
        onClose={onClose}
        onConfirm={vi.fn()}
        initialValue={{ name: 'Draft', description: 'Existing description' }}
      />,
    )

    const nameInput = screen.getByDisplayValue('Draft')
    const confirmButton = screen.getByRole('button', { name: 'workflow.snippet.confirm' })

    await user.clear(nameInput)
    await user.type(nameInput, '   ')

    expect(confirmButton).toBeDisabled()

    await user.click(screen.getByRole('button', { name: 'common.operation.cancel' }))

    expect(onClose).toHaveBeenCalledTimes(1)

    await waitFor(() => {
      expect(screen.getByPlaceholderText('workflow.snippet.namePlaceholder')).toHaveValue('')
      expect(screen.getByPlaceholderText('workflow.snippet.descriptionPlaceholder')).toHaveValue('')
    })
  })

  it('should use default graph and custom dialog labels when optional values are omitted', async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn()

    render(
      <CreateSnippetDialog
        isOpen
        title="Save as snippet"
        confirmText="Create now"
        onClose={vi.fn()}
        onConfirm={onConfirm}
      />,
    )

    expect(screen.getByText('Save as snippet')).toBeInTheDocument()

    await user.type(
      screen.getByPlaceholderText('workflow.snippet.namePlaceholder'),
      'Simple snippet',
    )
    await user.click(screen.getByRole('button', { name: 'Create now' }))

    expect(onConfirm).toHaveBeenCalledWith({
      name: 'Simple snippet',
      description: '',
      graph: {
        nodes: [],
        edges: [],
        viewport: { x: 0, y: 0, zoom: 1 },
      },
      input_fields: undefined,
    })
  })

  it('should submit from keyboard shortcuts only while open and not submitting', async () => {
    const onConfirm = vi.fn()
    const { rerender } = render(
      <CreateSnippetDialog
        isOpen={false}
        initialValue={{ name: 'Keyboard snippet' }}
        onClose={vi.fn()}
        onConfirm={onConfirm}
      />,
    )

    capturedKeyPressHandler?.()

    expect(onConfirm).not.toHaveBeenCalled()

    rerender(
      <CreateSnippetDialog
        isOpen
        isSubmitting
        initialValue={{ name: 'Keyboard snippet' }}
        onClose={vi.fn()}
        onConfirm={onConfirm}
      />,
    )

    capturedKeyPressHandler?.()

    expect(onConfirm).not.toHaveBeenCalled()

    rerender(
      <CreateSnippetDialog
        isOpen
        initialValue={{ name: 'Keyboard snippet' }}
        onClose={vi.fn()}
        onConfirm={onConfirm}
      />,
    )

    capturedKeyPressHandler?.()

    expect(onConfirm).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Keyboard snippet',
      }),
    )
    expect(capturedHotkeyOptions).toMatchObject({
      enabled: true,
      ignoreInputs: false,
      preventDefault: false,
      stopPropagation: false,
    })
    expect(capturedHotkeyOptions?.target?.current).toBe(screen.getByRole('dialog'))
    expect(capturedHotkey).toBe('Mod+Enter')
  })

  it('should disable form controls while submitting', () => {
    render(
      <CreateSnippetDialog
        isOpen
        isSubmitting
        initialValue={{ name: 'Submitting snippet' }}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
      />,
    )

    expect(screen.getByPlaceholderText('workflow.snippet.namePlaceholder')).toBeDisabled()
    expect(screen.getByPlaceholderText('workflow.snippet.descriptionPlaceholder')).toBeDisabled()
    expect(screen.getByRole('button', { name: 'common.operation.cancel' })).toBeDisabled()
    expectLoadingButton(screen.getByRole('button', { name: 'workflow.snippet.confirm' }))
  })
})
