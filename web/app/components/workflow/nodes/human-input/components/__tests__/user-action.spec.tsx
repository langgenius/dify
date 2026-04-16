import type { ReactNode } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { UserActionButtonType } from '../../types'
import UserActionItem from '../user-action'

const mockUseTranslation = vi.hoisted(() => vi.fn())
const mockNotify = vi.hoisted(() => vi.fn())

vi.mock('react-i18next', () => ({
  useTranslation: () => mockUseTranslation(),
}))

vi.mock('@/app/components/base/input', () => ({
  __esModule: true,
  default: (props: {
    value: string
    placeholder?: string
    disabled?: boolean
    onChange: (event: { target: { value: string } }) => void
  }) => (
    <input
      data-testid={props.placeholder}
      value={props.value}
      disabled={props.disabled}
      onChange={e => props.onChange({ target: { value: e.target.value } })}
    />
  ),
}))

vi.mock('@/app/components/base/ui/button', () => ({
  Button: (props: {
    children?: ReactNode
    onClick?: () => void
  }) => (
    <button type="button" onClick={props.onClick}>
      {props.children}
    </button>
  ),
}))

vi.mock('@/app/components/base/ui/toast', () => ({
  __esModule: true,
  toast: {
    success: (message: string) => mockNotify({ type: 'success', message }),
    error: (message: string) => mockNotify({ type: 'error', message }),
    warning: (message: string) => mockNotify({ type: 'warning', message }),
    info: (message: string) => mockNotify({ type: 'info', message }),
  },
}))

vi.mock('../button-style-dropdown', () => ({
  __esModule: true,
  default: (props: {
    onChange: (type: UserActionButtonType) => void
  }) => (
    <button type="button" onClick={() => props.onChange(UserActionButtonType.Ghost)}>
      change-style
    </button>
  ),
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
      t: (key: string) => key,
    })
  })

  it('should sanitize ids, enforce length limits, and update the button text', () => {
    render(
      <UserActionItem
        data={action}
        onChange={onChange}
        onDelete={onDelete}
      />,
    )

    fireEvent.change(screen.getByTestId('nodes.humanInput.userActions.actionNamePlaceholder'), { target: { value: 'Approve action' } })
    fireEvent.change(screen.getByTestId('nodes.humanInput.userActions.actionNamePlaceholder'), { target: { value: '1invalid' } })
    fireEvent.change(screen.getByTestId('nodes.humanInput.userActions.actionNamePlaceholder'), { target: { value: 'averyveryveryverylongidentifier' } })
    fireEvent.change(screen.getByTestId('nodes.humanInput.userActions.buttonTextPlaceholder'), { target: { value: 'A very very very long button title' } })

    expect(onChange).toHaveBeenNthCalledWith(1, expect.objectContaining({
      id: 'Approve_action',
    }))
    expect(onChange).toHaveBeenNthCalledWith(2, expect.objectContaining({
      id: 'averyveryveryverylon',
    }))
    expect(onChange).toHaveBeenNthCalledWith(3, expect.objectContaining({
      title: 'A very very very lon',
    }))
    expect(mockNotify).toHaveBeenNthCalledWith(1, expect.objectContaining({
      type: 'error',
      message: 'nodes.humanInput.userActions.actionIdFormatTip',
    }))
    expect(mockNotify).toHaveBeenNthCalledWith(2, expect.objectContaining({
      type: 'error',
      message: 'nodes.humanInput.userActions.actionIdTooLong',
    }))
    expect(mockNotify).toHaveBeenNthCalledWith(3, expect.objectContaining({
      type: 'error',
      message: 'nodes.humanInput.userActions.buttonTextTooLong',
    }))
  })

  it('should support clearing ids, updating button style, deleting, and readonly mode', () => {
    const { rerender } = render(
      <UserActionItem
        data={action}
        onChange={onChange}
        onDelete={onDelete}
      />,
    )

    fireEvent.change(screen.getByTestId('nodes.humanInput.userActions.actionNamePlaceholder'), { target: { value: '   ' } })
    fireEvent.click(screen.getByText('change-style'))
    fireEvent.click(screen.getAllByRole('button')[1]!)

    expect(onChange).toHaveBeenNthCalledWith(1, expect.objectContaining({ id: '' }))
    expect(onChange).toHaveBeenNthCalledWith(2, expect.objectContaining({ button_style: UserActionButtonType.Ghost }))
    expect(onDelete).toHaveBeenCalledWith('approve')

    rerender(
      <UserActionItem
        data={action}
        onChange={onChange}
        onDelete={onDelete}
        readonly
      />,
    )

    expect(screen.getByTestId('nodes.humanInput.userActions.actionNamePlaceholder'))!.toBeDisabled()
    expect(screen.getByTestId('nodes.humanInput.userActions.buttonTextPlaceholder'))!.toBeDisabled()
    expect(screen.getAllByRole('button')).toHaveLength(1)
  })
})
