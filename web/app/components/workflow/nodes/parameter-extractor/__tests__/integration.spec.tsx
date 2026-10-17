import type { Param } from '../types'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ChangeType } from '@/app/components/workflow/types'
import { toast } from '@/app/notifications'
import { ExtractParameterList } from '../components/extract-parameter/list'
import { ParameterDialog } from '../components/extract-parameter/update'
import { ParamType } from '../types'

vi.mock('@/app/notifications', () => ({
  toast: { error: vi.fn() },
}))

const mockToastError = vi.mocked(toast.error)
const createParam = (overrides: Partial<Param> = {}): Param => ({
  name: 'city',
  type: ParamType.string,
  description: 'City name',
  required: false,
  ...overrides,
})

describe('Parameter editing', () => {
  it('should show the empty state for an empty parameter list', () => {
    render(<ExtractParameterList readonly={false} list={[]} onChange={vi.fn()} />)

    expect(
      screen.getByText('workflowModels.nodes.parameterExtractor.extractParametersNotSet'),
    ).toBeInTheDocument()
  })

  it('should edit and delete parameters from the list', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    const { rerender } = render(
      <ExtractParameterList readonly={false} list={[createParam()]} onChange={onChange} />,
    )

    await user.click(screen.getByRole('button', { name: 'common.operation.edit city' }))
    fireEvent.change(screen.getByDisplayValue('city'), { target: { value: 'city_name' } })
    fireEvent.change(screen.getByDisplayValue('City name'), {
      target: { value: 'Updated city description' },
    })
    await user.click(screen.getByRole('button', { name: 'common.operation.save' }))

    expect(onChange).toHaveBeenCalledWith(
      [
        {
          name: 'city_name',
          type: ParamType.string,
          description: 'Updated city description',
          required: false,
        },
      ],
      { type: ChangeType.changeVarName, payload: { beforeKey: 'city', afterKey: 'city_name' } },
    )

    onChange.mockClear()

    rerender(
      <ExtractParameterList
        readonly={false}
        list={[createParam({ name: 'budget' })]}
        onChange={onChange}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'common.operation.delete budget' }))

    expect(onChange).toHaveBeenCalledWith([])
  })

  it('should validate required fields before saving an incomplete parameter', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn()

    render(
      <ParameterDialog
        type="edit"
        payload={createParam({
          name: '',
          description: '',
        })}
        onSave={onSave}
      />,
    )

    await user.click(screen.getByRole('button', { name: /^common.operation.edit/ }))

    await user.click(screen.getByRole('button', { name: 'common.operation.save' }))

    expect(onSave).not.toHaveBeenCalled()
    expect(mockToastError).toHaveBeenCalled()
  })

  it('should render the add trigger for new parameters', () => {
    render(<ParameterDialog type="add" onSave={vi.fn()} />)

    expect(
      screen.getByRole('button', {
        name: 'workflowModels.nodes.parameterExtractor.addExtractParameter',
      }),
    ).toBeInTheDocument()
  })

  it('should reject invalid names and reset add modal fields after canceling', async () => {
    const user = userEvent.setup()

    render(<ParameterDialog type="add" onSave={vi.fn()} />)

    await user.click(
      screen.getByRole('button', {
        name: 'workflowModels.nodes.parameterExtractor.addExtractParameter',
      }),
    )

    const nameInput = screen.getByPlaceholderText(
      'workflow.nodes.parameterExtractor.addExtractParameterContent.namePlaceholder',
    )
    const descriptionInput = screen.getByPlaceholderText(
      'workflow.nodes.parameterExtractor.addExtractParameterContent.descriptionPlaceholder',
    )

    fireEvent.change(nameInput, { target: { value: '1bad' } })
    expect(mockToastError).toHaveBeenCalled()
    expect(nameInput).toHaveValue('')

    fireEvent.change(nameInput, { target: { value: 'temporary_name' } })
    fireEvent.change(descriptionInput, { target: { value: 'Temporary description' } })

    await user.click(screen.getByRole('button', { name: 'common.operation.cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

    await user.click(
      screen.getByRole('button', {
        name: 'workflowModels.nodes.parameterExtractor.addExtractParameter',
      }),
    )
    expect(
      screen.getByPlaceholderText(
        'workflow.nodes.parameterExtractor.addExtractParameterContent.namePlaceholder',
      ),
    ).toHaveValue('')
    expect(
      screen.getByPlaceholderText(
        'workflow.nodes.parameterExtractor.addExtractParameterContent.descriptionPlaceholder',
      ),
    ).toHaveValue('')
  })

  it('should require select options before saving a select parameter', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn()

    render(
      <ParameterDialog
        type="edit"
        payload={createParam({
          name: 'status',
          type: ParamType.select,
          description: 'Status field',
          options: [],
        })}
        onSave={onSave}
      />,
    )

    await user.click(screen.getByRole('button', { name: /^common.operation.edit/ }))

    await user.click(screen.getByRole('button', { name: 'common.operation.save' }))

    expect(onSave).not.toHaveBeenCalled()
    expect(mockToastError).toHaveBeenCalled()
  })

  it('should keep rename metadata and updated options when editing a select parameter', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn()

    render(
      <ParameterDialog
        type="edit"
        payload={createParam({
          name: 'status',
          type: ParamType.select,
          description: 'Status',
          options: ['draft'],
        })}
        onSave={onSave}
      />,
    )

    await user.click(screen.getByRole('button', { name: /^common.operation.edit/ }))

    fireEvent.change(screen.getByDisplayValue('status'), {
      target: { value: 'approval_status' },
    })
    await user.click(screen.getByRole('button', { name: 'appDebug.variableConfig.addOption' }))
    await user.type(
      screen.getByRole('textbox', { name: 'appDebug.variableConfig.options 2' }),
      'published',
    )
    await user.click(await screen.findByRole('button', { name: 'common.operation.save' }))

    expect(onSave).toHaveBeenCalledWith(
      {
        name: 'approval_status',
        type: ParamType.select,
        description: 'Status',
        options: ['draft', 'published'],
        required: false,
      },
      {
        type: ChangeType.changeVarName,
        payload: { beforeKey: 'status', afterKey: 'approval_status' },
      },
    )
  })

  it('should persist rename metadata and required state for edited parameters', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn()

    render(
      <ParameterDialog
        type="edit"
        payload={createParam({
          name: 'status',
          description: 'Status description',
        })}
        onSave={onSave}
      />,
    )

    await user.click(screen.getByRole('button', { name: /^common.operation.edit/ }))

    fireEvent.change(screen.getByDisplayValue('status'), {
      target: { value: 'approval_status' },
    })
    await user.click(screen.getByRole('switch'))
    await user.click(screen.getByRole('button', { name: 'common.operation.save' }))

    expect(onSave).toHaveBeenCalledWith(
      {
        name: 'approval_status',
        type: ParamType.string,
        description: 'Status description',
        required: true,
      },
      {
        type: ChangeType.changeVarName,
        payload: { beforeKey: 'status', afterKey: 'approval_status' },
      },
    )
  })
})
