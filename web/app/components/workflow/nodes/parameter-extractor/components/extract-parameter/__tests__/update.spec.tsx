import type { Param } from '../../../types'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ChangeType } from '@/app/components/workflow/types'
import { toast } from '@/app/notifications'
import { ParamType } from '../../../types'
import { ParameterDialog } from '../update'

vi.mock('@/app/notifications', () => ({
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

    render(<ParameterDialog type="add" onSave={handleSave} />)

    const existingDialogs = screen.queryAllByRole('dialog').length

    fireEvent.click(
      screen.getByRole('button', {
        name: 'workflowModels.nodes.parameterExtractor.addExtractParameter',
      }),
    )
    const dialogs = await waitFor(() => {
      const nextDialogs = screen.getAllByRole('dialog')
      expect(nextDialogs.length).toBeGreaterThan(existingDialogs)
      return nextDialogs
    })
    const dialog = dialogs.at(-1)!
    const nameInput = within(dialog).getByRole('textbox', {
      name: 'workflowModels.nodes.parameterExtractor.addExtractParameterContent.name',
    })
    const descriptionInput = within(dialog).getByPlaceholderText(
      'workflow.nodes.parameterExtractor.addExtractParameterContent.descriptionPlaceholder',
    )

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
      expect(handleSave).toHaveBeenCalledWith(
        {
          name: 'budget',
          type: ParamType.string,
          description: 'Budget amount',
          required: false,
        },
        undefined,
      )
    })
  })

  it('rejects invalid variable names before saving', async () => {
    const user = userEvent.setup()
    const handleSave = vi.fn()

    render(<ParameterDialog type="add" onSave={handleSave} />)

    const existingDialogs = screen.queryAllByRole('dialog').length

    await user.click(
      screen.getByRole('button', {
        name: 'workflowModels.nodes.parameterExtractor.addExtractParameter',
      }),
    )
    const dialogs = await waitFor(() => {
      const nextDialogs = screen.getAllByRole('dialog')
      expect(nextDialogs.length).toBeGreaterThan(existingDialogs)
      return nextDialogs
    })
    const dialog = dialogs.at(-1)!

    fireEvent.change(
      within(dialog).getByRole('textbox', {
        name: 'workflowModels.nodes.parameterExtractor.addExtractParameterContent.name',
      }),
      {
        target: { value: '1bad' },
      },
    )

    expect(handleSave).not.toHaveBeenCalled()
    expect(mockToast.error).toHaveBeenCalled()
    expect(
      within(dialog).getByRole('textbox', {
        name: 'workflowModels.nodes.parameterExtractor.addExtractParameterContent.name',
      }),
    ).toHaveValue('')
  })

  it('validates required fields without closing the edit dialog', async () => {
    const user = userEvent.setup()
    const handleSave = vi.fn()

    render(
      <ParameterDialog
        type="edit"
        payload={createParam({
          name: '',
          description: '',
        })}
        onSave={handleSave}
      />,
    )

    await user.click(screen.getByRole('button', { name: /^common.operation.edit/ }))
    await user.click(screen.getByRole('button', { name: 'common.operation.save' }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()

    expect(handleSave).not.toHaveBeenCalled()
    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalled()
    })
  })

  it('requires options before saving a select parameter', async () => {
    const user = userEvent.setup()
    const handleSave = vi.fn()

    render(
      <ParameterDialog
        type="edit"
        payload={createParam({
          type: ParamType.select,
          description: 'Status description',
          options: [],
        })}
        onSave={handleSave}
      />,
    )

    await user.click(screen.getByRole('button', { name: /^common.operation.edit/ }))
    await user.click(screen.getByRole('button', { name: 'common.operation.save' }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()

    expect(handleSave).not.toHaveBeenCalled()
    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalled()
    })
  })
  it('discards canceled drafts and reopens from the latest committed parameter', async () => {
    const user = userEvent.setup()
    const { rerender } = render(
      <ParameterDialog type="edit" payload={createParam()} onSave={vi.fn()} />,
    )
    await user.click(screen.getByRole('button', { name: 'common.operation.edit city' }))
    expect(screen.getByRole('dialog', { name: 'common.operation.edit city' })).toBeInTheDocument()
    await user.type(screen.getByRole('textbox', { name: /Content.name$/ }), '_draft')
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    rerender(
      <ParameterDialog type="edit" payload={createParam({ name: 'country' })} onSave={vi.fn()} />,
    )
    await user.click(screen.getByRole('button', { name: 'common.operation.edit country' }))
    expect(screen.getByRole('textbox', { name: /Content.name$/ })).toHaveValue('country')
  })

  it('preserves the original rename source after typing and editing other fields, then submits with Enter', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn()
    render(<ParameterDialog type="edit" payload={createParam()} onSave={onSave} />)
    await user.click(screen.getByRole('button', { name: 'common.operation.edit city' }))
    const name = screen.getByRole('textbox', { name: /Content.name$/ })
    await user.type(name, '_name')
    await user.type(screen.getByRole('textbox', { name: /Content.description$/ }), ' updated')
    await user.click(name)
    await user.keyboard('{Enter}')
    expect(onSave).toHaveBeenCalledExactlyOnceWith(
      createParam({ name: 'city_name', description: 'City name updated' }),
      {
        type: ChangeType.changeVarName,
        payload: { beforeKey: 'city', afterKey: 'city_name' },
      },
    )
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })
})
