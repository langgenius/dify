import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import VariableTypeSelector from '../variable-type-select'

describe('VariableTypeSelector', () => {
  it('opens the selector and applies a new type', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    render(
      <VariableTypeSelector
        value="string"
        list={['string', 'number', 'boolean']}
        onSelect={onSelect}
      />,
    )

    await user.click(screen.getByText('string'))
    await user.click(screen.getByText('number'))

    expect(onSelect).toHaveBeenCalledWith('number')
  })

  it('dismisses the popup through the real portal flow', async () => {
    const user = userEvent.setup()
    render(
      <VariableTypeSelector
        value="string"
        list={['string', 'number']}
        onSelect={vi.fn()}
      />,
    )

    await user.click(screen.getByText('string'))
    expect(screen.getByText('number')).toBeInTheDocument()

    await user.keyboard('{Escape}')

    await waitFor(() => {
      expect(screen.queryByText('number')).not.toBeInTheDocument()
    })
  })

  it('keeps the custom popup class in in-cell mode', async () => {
    const user = userEvent.setup()
    render(
      <VariableTypeSelector
        inCell
        value="string"
        list={['string', 'number']}
        popupClassName="custom-popup"
        onSelect={vi.fn()}
      />,
    )

    await user.click(screen.getAllByText('string')[0] as HTMLElement)

    expect(screen.getByText('number').closest('.custom-popup')).not.toBeNull()
  })
})
