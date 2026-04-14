import { fireEvent, render, screen, waitFor } from '@testing-library/react'
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

  // TODO: Fix this test.
  // This test only failed in the merge queue, and I don't know why.
  it.skip('edits and deletes parameters through the real item and modal flow', async () => {
    const user = userEvent.setup()
    const handleChange = vi.fn()
    const { container, rerender } = render(
      <List
        readonly={false}
        list={[createParam()]}
        onChange={handleChange}
      />,
    )

    const editAndDeleteButtons = container.querySelectorAll('.cursor-pointer.rounded-md.p-1')
    fireEvent.click(editAndDeleteButtons[0] as HTMLElement)
    fireEvent.change(screen.getByDisplayValue('city'), { target: { value: 'city_name' } })
    fireEvent.change(screen.getByDisplayValue('City name'), { target: { value: 'Updated city description' } })
    await user.click(screen.getByRole('button', { name: 'common.operation.save' }))

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

    const deleteButtons = container.querySelectorAll('.cursor-pointer.rounded-md.p-1')
    fireEvent.click(deleteButtons[1] as HTMLElement)

    expect(handleChange).toHaveBeenCalledWith([])
  })
})
