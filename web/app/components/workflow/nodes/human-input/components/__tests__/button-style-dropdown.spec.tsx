import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { withSelectorKey } from '@/test/i18n-mock'
import { UserActionButtonType } from '../../types'
import ButtonStyleDropdown from '../button-style-dropdown'

const mockUseTranslation = vi.hoisted(() => vi.fn())
vi.mock('react-i18next', () => ({
  useTranslation: () => mockUseTranslation(),
}))

describe('ButtonStyleDropdown', () => {
  const onChange = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    mockUseTranslation.mockReturnValue({
      t: withSelectorKey((key: string) => key),
    })
  })

  it('should open the style picker and update the selected style', async () => {
    const user = userEvent.setup()
    render(
      <ButtonStyleDropdown text="Approve" data={UserActionButtonType.Ghost} onChange={onChange} />,
    )

    await user.click(
      screen.getByRole('button', { name: 'nodes.humanInput.userActions.chooseStyle' }),
    )
    expect(screen.getByText('nodes.humanInput.userActions.chooseStyle')).toBeInTheDocument()
    await user.click(screen.getAllByRole('button', { name: 'Approve' })[0]!)

    expect(onChange).toHaveBeenCalledWith(UserActionButtonType.Primary)
  })

  it('opens from the named keyboard trigger and closes with Escape', async () => {
    const user = userEvent.setup()
    render(
      <ButtonStyleDropdown text="Approve" data={UserActionButtonType.Ghost} onChange={onChange} />,
    )

    const trigger = screen.getByRole('button', { name: 'nodes.humanInput.userActions.chooseStyle' })
    await user.tab()
    expect(trigger).toHaveFocus()
    await user.keyboard('{Enter}')
    expect(await screen.findByRole('dialog')).toBeInTheDocument()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('should keep the dropdown closed in readonly mode', async () => {
    const user = userEvent.setup()
    render(
      <ButtonStyleDropdown
        text="Approve"
        data={UserActionButtonType.Default}
        onChange={onChange}
        readonly
      />,
    )

    const trigger = screen.getByRole('button', { name: 'nodes.humanInput.userActions.chooseStyle' })
    expect(trigger).toBeDisabled()
    await user.click(trigger)

    expect(screen.queryByText('nodes.humanInput.userActions.chooseStyle')).not.toBeInTheDocument()
    expect(onChange).not.toHaveBeenCalled()
  })
})
