import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import HasNotSetAPI from '../has-not-set-api'

describe('HasNotSetAPI', () => {
  it('should call onSetting when manage models button is clicked', async () => {
    const user = userEvent.setup()
    const onSetting = vi.fn()
    render(<HasNotSetAPI onSetting={onSetting} />)

    await user.click(screen.getByRole('button', { name: 'appDebug.manageModels' }))
    expect(onSetting).toHaveBeenCalledTimes(1)
  })
})
