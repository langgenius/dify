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

  // TODO: Fix this test.
  // This test only failed in the merge queue, and I don't know why.
  it.skip('edits and deletes parameters through the real item and modal flow', async () => {
    const user = userEvent.setup()
    const handleChange = vi.fn()
    const { rerender } = render(
      <List
        readonly={false}
        list={[createParam()]}
        onChange={handleChange}
      />,
    )

    const cityLabel = screen.getByText('city')
    const cityRow = cityLabel.closest('.group.relative')
    if (!cityRow)
      throw new Error('Failed to locate city row')
    const editAndDeleteButtons = cityRow.querySelectorAll('.cursor-pointer.rounded-md.p-1')
    fireEvent.click(editAndDeleteButtons[0] as HTMLElement)

    await screen.findByRole('dialog')
    const dialog = screen.getAllByRole('dialog').at(-1)!
    fireEvent.change(
      within(dialog).getByPlaceholderText('workflow.nodes.parameterExtractor.addExtractParameterContent.namePlaceholder'),
      { target: { value: 'cityname' } },
    )
    fireEvent.change(
      within(dialog).getByPlaceholderText('workflow.nodes.parameterExtractor.addExtractParameterContent.descriptionPlaceholder'),
      { target: { value: 'Updated city description' } },
    )
    fireEvent.click(within(dialog).getByRole('button', { name: 'common.operation.save' }))

    await waitFor(() => {
      expect(handleChange).toHaveBeenCalled()
      expect(handleChange.mock.lastCall?.[0]).toEqual([{
        name: 'cityname',
        type: ParamType.string,
        description: 'Updated city description',
        required: false,
      }])
    })

    handleChange.mockClear()

    rerender(
      <List
        readonly={false}
        list={[createParam({ name: 'budget' })]}
        onChange={handleChange}
      />,
    )

    const budgetLabel = screen.getByText('budget')
    const budgetRow = budgetLabel.closest('.group.relative')
    if (!budgetRow)
      throw new Error('Failed to locate budget row')
    const deleteButtons = budgetRow.querySelectorAll('.cursor-pointer.rounded-md.p-1')
    fireEvent.click(deleteButtons[1] as HTMLElement)

    expect(handleChange).toHaveBeenCalledWith([])
  })
})
