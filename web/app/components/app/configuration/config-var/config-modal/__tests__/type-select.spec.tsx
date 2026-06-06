/* eslint-disable ts/no-explicit-any */
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import TypeSelector from '../type-select'

vi.mock('@langgenius/dify-ui/select', () => import('@/__mocks__/base-ui-select'))

vi.mock('@/app/components/workflow/nodes/_base/components/input-var-type-icon', () => ({
  default: ({ type }: { type: string }) => <span>{type}</span>,
}))

describe('TypeSelector', () => {
  it('should select a new variable type when an option is clicked', async () => {
    const onSelect = vi.fn()
    const user = userEvent.setup()

    render(
      <TypeSelector
        value="text-input"
        onSelect={onSelect}
        items={[
          { value: 'text-input' as any, name: 'Text' },
          { value: 'number' as any, name: 'Number' },
        ]}
      />,
    )

    await user.click(screen.getByRole('combobox'))
    const [, numberOption] = await screen.findAllByRole('option')
    await user.click(numberOption!)

    expect(onSelect).toHaveBeenCalledWith({ value: 'number', name: 'Number' })
  })

  it('should size popup content to match the trigger width', async () => {
    const user = userEvent.setup()

    render(
      <TypeSelector
        value="text-input"
        onSelect={vi.fn()}
        items={[
          { value: 'text-input' as any, name: 'Text' },
          { value: 'number' as any, name: 'Number' },
        ]}
      />,
    )

    await user.click(screen.getByRole('combobox'))

    const [, numberOption] = await screen.findAllByRole('option')
    const popup = numberOption!.closest('[data-side]')

    expect(popup).toHaveClass('w-(--anchor-width)')
  })
})
