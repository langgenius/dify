import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ParamType } from '../../../types'
import List from '../list'

const createParam = (overrides: Partial<{
  name: string
  type: ParamType
  description: string
  required: boolean
}> = {}) => ({
  name: 'city',
  type: ParamType.string,
  description: 'City name',
  required: false,
  ...overrides,
})

describe('parameter-extractor/extract-parameter/list', () => {
  it('renders the empty placeholder when no parameter is configured', () => {
    render(
      <List
        readonly={false}
        list={[]}
        onChange={vi.fn()}
      />,
    )

    expect(screen.getByText('workflow.nodes.parameterExtractor.extractParametersNotSet')).toBeInTheDocument()
  })

  it('edits and deletes parameters through the real item and modal flow', async () => {
    const user = userEvent.setup()
    const handleChange = vi.fn()
    const { rerender } = render(
      <List
        readonly={false}
        list={[createParam()]}
        onChange={handleChange}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'common.operation.edit' }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.change(within(dialog).getByDisplayValue('city'), { target: { value: 'city_name' } })
    fireEvent.change(within(dialog).getByDisplayValue('City name'), { target: { value: 'Updated city description' } })
    await user.click(within(dialog).getByRole('button', { name: 'common.operation.save' }))

    await waitFor(() => {
      expect(handleChange.mock.lastCall).toEqual([[{
        name: 'city_name',
        type: ParamType.string,
        description: 'Updated city description',
        required: false,
      }], undefined])
    })

    handleChange.mockClear()

    rerender(
      <List
        readonly={false}
        list={[createParam({ name: 'budget' })]}
        onChange={handleChange}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'common.operation.delete' }))

    expect(handleChange).toHaveBeenCalledWith([])
  })
})
