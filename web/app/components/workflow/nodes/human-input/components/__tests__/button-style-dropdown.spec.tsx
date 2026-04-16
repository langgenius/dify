import { fireEvent, render, screen } from '@testing-library/react'
import * as React from 'react'
import { UserActionButtonType } from '../../types'
import ButtonStyleDropdown from '../button-style-dropdown'

const mockUseTranslation = vi.hoisted(() => vi.fn())
const mockButton = vi.hoisted(() => vi.fn())

vi.mock('react-i18next', () => ({
  useTranslation: () => mockUseTranslation(),
}))

vi.mock('@/app/components/base/ui/button', () => ({
  Button: (props: {
    variant?: string
    children?: React.ReactNode
    className?: string
  }) => {
    mockButton(props)
    return <div data-testid={`button-${props.variant ?? 'default'}`}>{props.children}</div>
  },
}))

vi.mock('@/app/components/base/portal-to-follow-elem', () => {
  const OpenContext = React.createContext(false)

  return {
    PortalToFollowElem: ({
      open,
      children,
    }: {
      open: boolean
      children?: React.ReactNode
    }) => (
      <OpenContext value={open}>
        <div data-testid="portal" data-open={String(open)}>{children}</div>
      </OpenContext>
    ),
    PortalToFollowElemTrigger: ({
      children,
      onClick,
    }: {
      children?: React.ReactNode
      onClick?: () => void
    }) => (
      <button type="button" data-testid="portal-trigger" onClick={onClick}>
        {children}
      </button>
    ),
    PortalToFollowElemContent: ({
      children,
    }: {
      children?: React.ReactNode
    }) => {
      const open = React.use(OpenContext)
      return open ? <div data-testid="portal-content">{children}</div> : null
    },
  }
})

describe('ButtonStyleDropdown', () => {
  const onChange = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    mockUseTranslation.mockReturnValue({
      t: (key: string) => key,
    })
  })

  it('should map the current style to the trigger button and update the selected style', () => {
    render(
      <ButtonStyleDropdown
        text="Approve"
        data={UserActionButtonType.Ghost}
        onChange={onChange}
      />,
    )

    expect(mockButton).toHaveBeenCalledWith(expect.objectContaining({
      variant: 'ghost',
    }))
    expect(screen.getByTestId('portal'))!.toHaveAttribute('data-open', 'false')

    fireEvent.click(screen.getByTestId('portal-trigger'))
    expect(screen.getByTestId('portal'))!.toHaveAttribute('data-open', 'true')
    expect(screen.getByText('nodes.humanInput.userActions.chooseStyle'))!.toBeInTheDocument()

    fireEvent.click(screen.getByTestId('button-primary').parentElement as HTMLElement)
    fireEvent.click(screen.getByTestId('button-secondary').parentElement as HTMLElement)
    fireEvent.click(screen.getByTestId('button-secondary-accent').parentElement as HTMLElement)
    fireEvent.click(screen.getAllByTestId('button-ghost')[1]!.parentElement as HTMLElement)

    expect(onChange).toHaveBeenNthCalledWith(1, UserActionButtonType.Primary)
    expect(onChange).toHaveBeenNthCalledWith(2, UserActionButtonType.Default)
    expect(onChange).toHaveBeenNthCalledWith(3, UserActionButtonType.Accent)
    expect(onChange).toHaveBeenNthCalledWith(4, UserActionButtonType.Ghost)
  })

  it('should keep the dropdown closed in readonly mode', () => {
    render(
      <ButtonStyleDropdown
        text="Approve"
        data={UserActionButtonType.Default}
        onChange={onChange}
        readonly
      />,
    )

    expect(mockButton).toHaveBeenCalledWith(expect.objectContaining({
      variant: 'secondary',
    }))

    fireEvent.click(screen.getByTestId('portal-trigger'))

    expect(screen.getByTestId('portal'))!.toHaveAttribute('data-open', 'false')
    expect(screen.queryByTestId('portal-content')).not.toBeInTheDocument()
    expect(onChange).not.toHaveBeenCalled()
  })

  it('should map the accent style to the secondary-accent trigger button', () => {
    render(
      <ButtonStyleDropdown
        text="Approve"
        data={UserActionButtonType.Accent}
        onChange={onChange}
      />,
    )

    expect(mockButton).toHaveBeenCalledWith(expect.objectContaining({
      variant: 'secondary-accent',
    }))
  })

  it('should map the primary style to the primary trigger button', () => {
    render(
      <ButtonStyleDropdown
        text="Approve"
        data={UserActionButtonType.Primary}
        onChange={onChange}
      />,
    )

    expect(mockButton).toHaveBeenCalledWith(expect.objectContaining({
      variant: 'primary',
    }))
  })
})
