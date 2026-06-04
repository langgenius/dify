import type { SnippetCanvasData, SnippetInputField } from '@/models/snippet'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PipelineInputVarType } from '@/models/pipeline'
import CreateSnippetDialog from '../create-snippet-dialog'

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

    await user.type(screen.getByPlaceholderText('workflow.snippet.namePlaceholder'), '  Support snippet  ')
    await user.type(screen.getByPlaceholderText('workflow.snippet.descriptionPlaceholder'), '  Helps agents  ')
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
})
