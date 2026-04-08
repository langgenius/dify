/* eslint-disable ts/no-explicit-any */
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import AccessControlDialog from '../access-control-dialog'

vi.mock('@headlessui/react', () => {
  const DialogComponent: any = ({ children, className, ...rest }: any) => (
    <div role="dialog" className={className} {...rest}>{children}</div>
  )
  DialogComponent.Panel = ({ children, className, ...rest }: any) => (
    <div className={className} {...rest}>{children}</div>
  )
  const TransitionChild = ({ children }: any) => (
    <>{typeof children === 'function' ? children({}) : children}</>
  )
  const Transition = ({ show = true, children }: any) => (
    show ? <>{typeof children === 'function' ? children({}) : children}</> : null
  )
  Transition.Child = TransitionChild
  return {
    Dialog: DialogComponent,
    Transition,
  }
})

describe('AccessControlDialog', () => {
  it('should render dialog content when visible', () => {
    render(
      <AccessControlDialog show className="custom-dialog">
        <div>Dialog Content</div>
      </AccessControlDialog>,
    )

    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByText('Dialog Content')).toBeInTheDocument()
  })

  it('should trigger onClose when clicking the close control', async () => {
    const onClose = vi.fn()
    const { container } = render(
      <AccessControlDialog show onClose={onClose}>
        <div>Dialog Content</div>
      </AccessControlDialog>,
    )

    const closeButton = container.querySelector('.absolute.right-5.top-5') as HTMLElement
    fireEvent.click(closeButton)

    await waitFor(() => {
      expect(onClose).toHaveBeenCalledTimes(1)
    })
  })
})
