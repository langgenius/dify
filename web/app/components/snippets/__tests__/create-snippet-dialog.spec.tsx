import type { SnippetCanvasData, SnippetInputField } from '@/models/snippet'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PipelineInputVarType } from '@/models/pipeline'
import { expectLoadingButton } from '@/test/button'
import { CreateSnippetDialog } from '../create-snippet-dialog'

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
  })

  it('should submit trimmed snippet values with the selected graph and input fields', async () => {
    const user = userEvent.setup()
    const onOpenChange = vi.fn()
    const onConfirm = vi.fn()

    render(
      <CreateSnippetDialog
        open
        selectedGraph={selectedGraph}
        inputFields={inputFields}
        onOpenChange={onOpenChange}
        onConfirm={onConfirm}
      />,
    )

    const nameInput = screen.getByRole('textbox', { name: 'workflow.snippet.nameLabel' })

    await waitFor(() => {
      expect(nameInput).toHaveFocus()
    })

    await user.type(nameInput, '  Support snippet  ')
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
    expect(onOpenChange).not.toHaveBeenCalled()
  })

  it('keeps the edited draft until closing and reads fresh metadata when reopened', async () => {
    const user = userEvent.setup()
    const onOpenChange = vi.fn()
    const props = {
      onOpenChange,
      onConfirm: vi.fn(),
      initialValue: { name: 'Draft', description: 'Existing description' },
    }
    const { rerender } = render(<CreateSnippetDialog {...props} open />)
    const input = screen.getByRole('textbox', { name: 'workflow.snippet.nameLabel' })
    await user.clear(input)
    await user.type(input, '   ')
    expect(screen.getByRole('button', { name: 'workflow.snippet.confirm' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'common.operation.cancel' }))
    expect(onOpenChange).toHaveBeenCalledWith(false, expect.anything())
    expect(input).toHaveValue('   ')
    rerender(<CreateSnippetDialog {...props} open={false} />)
    await waitFor(() => expect(input).not.toBeInTheDocument())
    rerender(<CreateSnippetDialog {...props} initialValue={{ name: 'Updated source' }} open />)
    expect(await screen.findByRole('textbox', { name: 'workflow.snippet.nameLabel' })).toHaveValue(
      'Updated source',
    )
    expect(screen.getByRole('textbox', { name: 'workflow.snippet.descriptionLabel' })).toHaveValue(
      '',
    )
  })

  it('preserves plain Enter and description newlines without confirming', async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn()
    render(<CreateSnippetDialog open onOpenChange={vi.fn()} onConfirm={onConfirm} />)
    await user.type(
      screen.getByRole('textbox', { name: 'workflow.snippet.nameLabel' }),
      'Snippet{Enter}',
    )
    await user.type(
      screen.getByRole('textbox', { name: 'workflow.snippet.descriptionLabel' }),
      'First{Enter}Second',
    )
    expect(screen.getByRole('textbox', { name: 'workflow.snippet.descriptionLabel' })).toHaveValue(
      'First\nSecond',
    )
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('should use default graph and custom dialog labels when optional values are omitted', async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn()

    render(
      <CreateSnippetDialog
        open
        title="Save as snippet"
        confirmText="Create now"
        onOpenChange={vi.fn()}
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
        open={false}
        initialValue={{ name: 'Keyboard snippet' }}
        onOpenChange={vi.fn()}
        onConfirm={onConfirm}
      />,
    )

    fireEvent.keyDown(
      screen.queryByRole('textbox', { name: 'workflow.snippet.nameLabel' }) ?? document.body,
      { key: 'Enter', code: 'Enter', ctrlKey: true },
    )
    fireEvent.keyUp(
      screen.queryByRole('textbox', { name: 'workflow.snippet.nameLabel' }) ?? document.body,
      { key: 'Enter', code: 'Enter', ctrlKey: true },
    )

    expect(onConfirm).not.toHaveBeenCalled()

    rerender(
      <CreateSnippetDialog
        open
        isSubmitting
        initialValue={{ name: 'Keyboard snippet' }}
        onOpenChange={vi.fn()}
        onConfirm={onConfirm}
      />,
    )

    fireEvent.keyDown(
      screen.queryByRole('textbox', { name: 'workflow.snippet.nameLabel' }) ?? document.body,
      { key: 'Enter', code: 'Enter', ctrlKey: true },
    )
    fireEvent.keyUp(
      screen.queryByRole('textbox', { name: 'workflow.snippet.nameLabel' }) ?? document.body,
      { key: 'Enter', code: 'Enter', ctrlKey: true },
    )

    expect(onConfirm).not.toHaveBeenCalled()

    rerender(
      <CreateSnippetDialog
        open
        initialValue={{ name: 'Keyboard snippet' }}
        onOpenChange={vi.fn()}
        onConfirm={onConfirm}
      />,
    )

    fireEvent.keyDown(
      screen.queryByRole('textbox', { name: 'workflow.snippet.nameLabel' }) ?? document.body,
      { key: 'Enter', code: 'Enter', ctrlKey: true },
    )
    fireEvent.keyUp(
      screen.queryByRole('textbox', { name: 'workflow.snippet.nameLabel' }) ?? document.body,
      { key: 'Enter', code: 'Enter', ctrlKey: true },
    )

    expect(onConfirm).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Keyboard snippet',
      }),
    )
  })

  it('handles the first shortcut after opening and reopening its portal without a draft change', async () => {
    const onConfirm = vi.fn()
    const props = {
      initialValue: { name: 'Portal snippet' },
      onOpenChange: vi.fn(),
      onConfirm,
    }
    const { rerender } = render(<CreateSnippetDialog {...props} open={false} />)
    for (let opened = 1; opened <= 2; opened++) {
      rerender(<CreateSnippetDialog {...props} open />)
      const input = await screen.findByRole('textbox', { name: 'workflow.snippet.nameLabel' })
      const repeat = new KeyboardEvent('keydown', {
        key: 'Enter',
        ctrlKey: true,
        repeat: true,
        bubbles: true,
        cancelable: true,
      })
      fireEvent(input, repeat)
      expect(repeat.defaultPrevented).toBe(true)
      expect(onConfirm).toHaveBeenCalledTimes(opened - 1)
      fireEvent.keyDown(input, { key: 'Enter', ctrlKey: true })
      fireEvent.keyUp(input, { key: 'Enter', ctrlKey: true })
      expect(onConfirm).toHaveBeenCalledTimes(opened)
      rerender(<CreateSnippetDialog {...props} open={false} />)
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
      fireEvent.keyDown(document.body, { key: 'Enter', ctrlKey: true })
      expect(onConfirm).toHaveBeenCalledTimes(opened)
    }
  })

  it('lets a child React handler claim the shortcut before the dialog action', () => {
    const onConfirm = vi.fn()
    render(
      <CreateSnippetDialog
        open
        initialValue={{ name: 'Nested control' }}
        onOpenChange={vi.fn()}
        onConfirm={onConfirm}
      />,
    )
    const dialog = screen.getByRole('dialog')
    const childContainer = document.createElement('div')
    dialog.append(childContainer)
    const childClaim = vi.fn((event: React.KeyboardEvent<HTMLButtonElement>) =>
      event.preventDefault(),
    )
    const child = render(
      <button type="button" onKeyDown={childClaim}>
        Child action
      </button>,
      { container: childContainer },
    )
    const options = { key: 'Enter', ctrlKey: true }
    fireEvent.keyDown(screen.getByRole('button', { name: 'Child action' }), options)
    expect(childClaim).toHaveBeenCalledOnce()
    expect(onConfirm).not.toHaveBeenCalled()

    child.rerender(<button type="button">Child action</button>)
    fireEvent.keyDown(screen.getByRole('button', { name: 'Child action' }), options)
    expect(onConfirm).toHaveBeenCalledOnce()

    child.unmount()
  })

  it('disables editing and Cancel while submitting but preserves header dismissal', async () => {
    const user = userEvent.setup()
    const onOpenChange = vi.fn()
    render(
      <CreateSnippetDialog
        open
        isSubmitting
        initialValue={{ name: 'Submitting snippet' }}
        onOpenChange={onOpenChange}
        onConfirm={vi.fn()}
      />,
    )

    expect(screen.getByPlaceholderText('workflow.snippet.namePlaceholder')).toBeDisabled()
    expect(screen.getByPlaceholderText('workflow.snippet.descriptionPlaceholder')).toBeDisabled()
    expect(screen.getByRole('button', { name: 'common.operation.cancel' })).toBeDisabled()
    expectLoadingButton(screen.getByRole('button', { name: 'workflow.snippet.confirm' }))
    await user.click(screen.getByRole('button', { name: 'common.operation.close' }))
    expect(onOpenChange).toHaveBeenCalledWith(false, expect.anything())
  })
})
