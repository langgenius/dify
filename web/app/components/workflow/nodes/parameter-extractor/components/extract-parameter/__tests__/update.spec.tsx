import type { Param } from '../../../types'
import { toast } from '@langgenius/dify-ui/toast'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ParamType } from '../../../types'
import Update from '../update'

vi.mock('@langgenius/dify-ui/toast', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
  },
}))

const mockToast = vi.mocked(toast)

const createParam = (overrides: Partial<Param> = {}): Param => ({
  name: 'city',
  type: ParamType.string,
  description: 'City name',
  required: false,
  ...overrides,
})

describe('parameter-extractor/extract-parameter/update', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('opens from the add trigger and saves a new parameter', async () => {
    const handleSave = vi.fn()

    render(
      <Update
        type="add"
        onSave={handleSave}
      />,
    )

    const existingDialogs = screen.queryAllByRole('dialog').length

    fireEvent.click(screen.getByRole('button', { name: 'workflow.nodes.parameterExtractor.addExtractParameter' }))
    const dialogs = await waitFor(() => {
      const nextDialogs = screen.getAllByRole('dialog')
      expect(nextDialogs.length).toBeGreaterThan(existingDialogs)
      return nextDialogs
    })
    const dialog = dialogs.at(-1)!
    const nameInput = within(dialog).getByPlaceholderText('workflow.nodes.parameterExtractor.addExtractParameterContent.namePlaceholder')
    const descriptionInput = within(dialog).getByPlaceholderText('workflow.nodes.parameterExtractor.addExtractParameterContent.descriptionPlaceholder')

    fireEvent.change(nameInput, {
      target: { value: 'budget' },
    })
    fireEvent.change(descriptionInput, {
      target: { value: 'Budget amount' },
    })

    await waitFor(() => {
      expect(nameInput).toHaveValue('budget')
      expect(descriptionInput).toHaveValue('Budget amount')
    })

    fireEvent.click(within(dialog).getByRole('button', { name: 'common.operation.add' }))

    await waitFor(() => {
      expect(handleSave).toHaveBeenCalledWith({
        name: 'budget',
        type: ParamType.string,
        description: 'Budget amount',
        required: false,
      }, undefined)
    })
  })

  it('rejects invalid variable names before saving', async () => {
    const user = userEvent.setup()
    const handleSave = vi.fn()

    render(
      <Update
        type="add"
        onSave={handleSave}
      />,
    )

    const existingDialogs = screen.queryAllByRole('dialog').length

    await user.click(screen.getByRole('button', { name: 'workflow.nodes.parameterExtractor.addExtractParameter' }))
    const dialogs = await waitFor(() => {
      const nextDialogs = screen.getAllByRole('dialog')
      expect(nextDialogs.length).toBeGreaterThan(existingDialogs)
      return nextDialogs
    })
    const dialog = dialogs.at(-1)!

    fireEvent.change(within(dialog).getByPlaceholderText('workflow.nodes.parameterExtractor.addExtractParameterContent.namePlaceholder'), {
      target: { value: '1bad' },
    })

    expect(handleSave).not.toHaveBeenCalled()
    expect(mockToast.error).toHaveBeenCalled()
    expect(within(dialog).getByPlaceholderText('workflow.nodes.parameterExtractor.addExtractParameterContent.namePlaceholder')).toHaveValue('')
  })

  it('renders the edit modal immediately and validates required fields', async () => {
    const user = userEvent.setup()
    const handleSave = vi.fn()

    render(
      <Update
        type="edit"
        payload={createParam({
          name: '',
          description: '',
        })}
        onSave={handleSave}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'common.operation.save' }))

    expect(handleSave).not.toHaveBeenCalled()
    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalled()
    })
  })

  it('requires options before saving a select parameter', async () => {
    const user = userEvent.setup()
    const handleSave = vi.fn()

    render(
      <Update
        type="edit"
        payload={createParam({
          type: ParamType.select,
          description: 'Status description',
          options: [],
        })}
        onSave={handleSave}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'common.operation.save' }))

    expect(handleSave).not.toHaveBeenCalled()
    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalled()
    })
  })
})
