import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ArrayBoolList from '../array-bool-list'

describe('ArrayBoolList', () => {
  it('toggles, appends, and removes boolean values', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    const { container } = render(
      <ArrayBoolList
        list={[true]}
        onChange={onChange}
      />,
    )

    await user.click(screen.getByText('False'))
    await user.click(screen.getByText('workflow.chatVariable.modal.addArrayValue'))
    await user.click(container.querySelector('button') as HTMLButtonElement)

    expect(onChange).toHaveBeenNthCalledWith(1, [false])
    expect(onChange).toHaveBeenNthCalledWith(2, [true, false])
    expect(onChange).toHaveBeenNthCalledWith(3, [])
  })
})
