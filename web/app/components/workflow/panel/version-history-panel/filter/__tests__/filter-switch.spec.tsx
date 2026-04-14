import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import FilterSwitch from '../filter-switch'

describe('FilterSwitch', () => {
  it('renders the switch label and toggles through the change handler', async () => {
    const user = userEvent.setup()
    const handleSwitch = vi.fn()
    render(
      <FilterSwitch
        enabled={false}
        handleSwitch={handleSwitch}
      />,
    )

    expect(screen.getByText('workflow.versionHistory.filter.onlyShowNamedVersions')).toBeInTheDocument()

    await user.click(screen.getByRole('switch'))

    expect(handleSwitch).toHaveBeenCalledWith(true)
  })
})
