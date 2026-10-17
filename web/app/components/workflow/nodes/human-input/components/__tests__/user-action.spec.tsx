import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { withSelectorKey } from '@/test/i18n-mock'
import { UserActionButtonType } from '../../types'
import UserActionItem from '../user-action'

const mockUseTranslation = vi.hoisted(() => vi.fn())
const mockNotify = vi.hoisted(() => vi.fn())

vi.mock('react-i18next', () => ({
  useTranslation: () => mockUseTranslation(),
}))

vi.mock('@/app/notifications', () => ({
  __esModule: true,
  toast: {
    success: (message: string) => mockNotify({ type: 'success', message }),
    error: (message: string) => mockNotify({ type: 'error', message }),
    warning: (message: string) => mockNotify({ type: 'warning', message }),
    info: (message: string) => mockNotify({ type: 'info', message }),
  },
}))

describe('UserActionItem', () => {
  const onChange = vi.fn()
  const onDelete = vi.fn()
  const action = {
    id: 'approve',
    title: 'Approve',
    button_style: UserActionButtonType.Primary,
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockUseTranslation.mockReturnValue({
      t: withSelectorKey((key: string) => key),
    })
  })

  it('should sanitize ids, enforce length limits, and update the button text', () => {
    render(<UserActionItem data={action} onChange={onChange} onDelete={onDelete} />)

    fireEvent.change(
      screen.getByRole('textbox', { name: 'nodes.humanInput.userActions.actionNamePlaceholder' }),
      {
        target: { value: 'Approve action' },
      },
    )
    fireEvent.change(
      screen.getByRole('textbox', { name: 'nodes.humanInput.userActions.actionNamePlaceholder' }),
      {
        target: { value: '1invalid' },
      },
    )
    fireEvent.change(
      screen.getByRole('textbox', { name: 'nodes.humanInput.userActions.actionNamePlaceholder' }),
      {
        target: { value: 'averyveryveryverylongidentifier' },
      },
    )
    fireEvent.change(
      screen.getByRole('textbox', { name: 'nodes.humanInput.userActions.buttonTextPlaceholder' }),
      {
        target: { value: 'card_visa_enterprise_001' },
      },
    )

    expect(onChange).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        id: 'Approve_action',
      }),
    )
    expect(onChange).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        id: 'averyveryveryverylon',
      }),
    )
    expect(onChange).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        title: 'card_visa_enterprise_001',
      }),
    )
    expect(mockNotify).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        type: 'error',
        message: 'nodes.humanInput.userActions.actionIdFormatTip',
      }),
    )
    expect(mockNotify).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        type: 'error',
        message: 'nodes.humanInput.userActions.actionIdTooLong',
      }),
    )
    expect(mockNotify).toHaveBeenCalledTimes(2)
  })

  it('should support clearing ids, updating button style, deleting, and readonly mode', async () => {
    const user = userEvent.setup()
    const { rerender } = render(
      <UserActionItem data={action} onChange={onChange} onDelete={onDelete} />,
    )

    fireEvent.change(
      screen.getByRole('textbox', { name: 'nodes.humanInput.userActions.actionNamePlaceholder' }),
      {
        target: { value: '   ' },
      },
    )
    await user.click(
      screen.getByRole('button', { name: 'Approve: nodes.humanInput.userActions.chooseStyle' }),
    )
    await user.click(
      await screen.findByRole('radio', {
        name: 'Approve, nodes.humanInput.userActions.buttonStyle.ghost',
      }),
    )
    await user.keyboard('{Escape}')
    fireEvent.click(screen.getByRole('button', { name: 'operation.delete' }))

    expect(onChange).toHaveBeenNthCalledWith(1, expect.objectContaining({ id: '' }))
    expect(onChange).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ button_style: UserActionButtonType.Ghost }),
    )
    expect(onDelete).toHaveBeenCalledWith('approve')

    rerender(<UserActionItem data={action} onChange={onChange} onDelete={onDelete} readonly />)

    expect(
      screen.getByRole('textbox', { name: 'nodes.humanInput.userActions.actionNamePlaceholder' }),
    )!.toBeDisabled()
    expect(
      screen.getByRole('textbox', { name: 'nodes.humanInput.userActions.buttonTextPlaceholder' }),
    )!.toBeDisabled()
    expect(
      screen.getByRole('button', { name: 'Approve: nodes.humanInput.userActions.chooseStyle' }),
    ).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'operation.delete' })).not.toBeInTheDocument()
  })
})
