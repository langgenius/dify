import type { Param } from '../../../types'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { toast } from '@/app/components/base/ui/toast'
import { ParamType } from '../../../types'
import Update from '../update'

vi.mock('@/app/components/base/ui/toast', () => ({
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
    const user = userEvent.setup()
    const handleSave = vi.fn()

    render(
      <Update
        type="add"
        onSave={handleSave}
      />,
    )

    await user.click(screen.getByTestId('add-button'))
    await screen.findByRole('button', { name: 'common.operation.add' })
    fireEvent.change(screen.getByPlaceholderText('workflow.nodes.parameterExtractor.addExtractParameterContent.namePlaceholder'), {
      target: { value: 'budget' },
    })
    fireEvent.change(screen.getByPlaceholderText('workflow.nodes.parameterExtractor.addExtractParameterContent.descriptionPlaceholder'), {
      target: { value: 'Budget amount' },
    })
    await user.click(await screen.findByRole('button', { name: 'common.operation.add' }))

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

    await user.click(screen.getByTestId('add-button'))
    fireEvent.change(screen.getByPlaceholderText('workflow.nodes.parameterExtractor.addExtractParameterContent.namePlaceholder'), {
      target: { value: '1bad' },
    })

    expect(handleSave).not.toHaveBeenCalled()
    expect(mockToast.error).toHaveBeenCalled()
    expect(screen.getByPlaceholderText('workflow.nodes.parameterExtractor.addExtractParameterContent.namePlaceholder')).toHaveValue('')
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
    expect(mockToast.error).toHaveBeenCalled()
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
    expect(mockToast.error).toHaveBeenCalled()
  })
})
