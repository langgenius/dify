import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ToggleExpandBtn from '../toggle-expand-btn'

describe('ToggleExpandBtn', () => {
  it('exposes the localized next action and toggles expansion', async () => {
    const user = userEvent.setup()
    const onExpandChange = vi.fn()
    const { rerender } = render(
      <ToggleExpandBtn isExpand={false} onExpandChange={onExpandChange} />,
    )

    await user.click(screen.getByRole('button', { name: 'share.chat.expand' }))
    expect(onExpandChange).toHaveBeenCalledWith(true)

    rerender(<ToggleExpandBtn isExpand onExpandChange={onExpandChange} />)
    await user.click(screen.getByRole('button', { name: 'share.chat.collapse' }))
    expect(onExpandChange).toHaveBeenLastCalledWith(false)
  })
})
