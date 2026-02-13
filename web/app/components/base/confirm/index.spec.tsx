import { act, fireEvent, render, screen } from '@testing-library/react'
import Confirm from '.'

vi.mock('react-dom', async () => {
  const actual = await vi.importActual<typeof import('react-dom')>('react-dom')

  return {
    ...actual,
    createPortal: (children: React.ReactNode) => children,
  }
})

const onCancel = vi.fn()
const onConfirm = vi.fn()

describe('Confirm Component', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Rendering', () => {
    it('renders confirm correctly', () => {
      render(<Confirm isShow={true} title="test title" onCancel={onCancel} onConfirm={onConfirm} />)
      expect(screen.getByText('test title')).toBeInTheDocument()
    })

    it('does not render on isShow false', () => {
      const { container } = render(<Confirm isShow={false} title="test title" onCancel={onCancel} onConfirm={onConfirm} />)
      expect(container.firstChild).toBeNull()
    })

    it('hides after delay when isShow changes to false', () => {
      vi.useFakeTimers()
      const { rerender } = render(<Confirm isShow={true} title="test title" onCancel={onCancel} onConfirm={onConfirm} />)
      expect(screen.getByText('test title')).toBeInTheDocument()

      rerender(<Confirm isShow={false} title="test title" onCancel={onCancel} onConfirm={onConfirm} />)
      act(() => {
        vi.advanceTimersByTime(200)
      })
      expect(screen.queryByText('test title')).not.toBeInTheDocument()
      vi.useRealTimers()
    })

    it('renders content when provided', () => {
      render(<Confirm isShow={true} title="title" content="some description" onCancel={onCancel} onConfirm={onConfirm} />)
      expect(screen.getByText('some description')).toBeInTheDocument()
    })
  })

  describe('Props', () => {
    it('showCancel prop works', () => {
      render(<Confirm isShow={true} title="test title" onCancel={onCancel} onConfirm={onConfirm} showCancel={false} />)
      expect(screen.getByRole('button', { name: 'common.operation.confirm' })).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'common.operation.cancel' })).not.toBeInTheDocument()
    })

    it('showConfirm prop works', () => {
      render(<Confirm isShow={true} title="test title" onCancel={onCancel} onConfirm={onConfirm} showConfirm={false} />)
      expect(screen.getByRole('button', { name: 'common.operation.cancel' })).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'common.operation.confirm' })).not.toBeInTheDocument()
    })

    it('renders custom confirm and cancel text', () => {
      render(<Confirm isShow={true} title="title" confirmText="Yes" cancelText="No" onCancel={onCancel} onConfirm={onConfirm} />)
      expect(screen.getByRole('button', { name: 'Yes' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'No' })).toBeInTheDocument()
    })

    it('disables confirm button when isDisabled is true', () => {
      render(<Confirm isShow={true} title="title" isDisabled={true} onCancel={onCancel} onConfirm={onConfirm} />)
      expect(screen.getByRole('button', { name: 'common.operation.confirm' })).toBeDisabled()
    })
  })

  describe('User Interactions', () => {
    it('clickAway is handled properly', () => {
      render(<Confirm isShow={true} title="test title" onCancel={onCancel} onConfirm={onConfirm} />)
      const overlay = screen.getByTestId('confirm-overlay') as HTMLElement
      expect(overlay).toBeTruthy()
      fireEvent.mouseDown(overlay)
      expect(onCancel).toHaveBeenCalledTimes(1)
    })

    it('overlay click stops propagation', () => {
      render(<Confirm isShow={true} title="test title" onCancel={onCancel} onConfirm={onConfirm} />)
      const overlay = screen.getByTestId('confirm-overlay') as HTMLElement
      const clickEvent = new MouseEvent('click', { bubbles: true, cancelable: true })
      const preventDefaultSpy = vi.spyOn(clickEvent, 'preventDefault')
      const stopPropagationSpy = vi.spyOn(clickEvent, 'stopPropagation')
      overlay.dispatchEvent(clickEvent)
      expect(preventDefaultSpy).toHaveBeenCalled()
      expect(stopPropagationSpy).toHaveBeenCalled()
    })

    it('does not close on click away when maskClosable is false', () => {
      render(<Confirm isShow={true} title="test title" maskClosable={false} onCancel={onCancel} onConfirm={onConfirm} />)
      const overlay = screen.getByTestId('confirm-overlay') as HTMLElement
      fireEvent.mouseDown(overlay)
      expect(onCancel).not.toHaveBeenCalled()
    })

    it('escape keyboard event works', () => {
      render(<Confirm isShow={true} title="test title" onCancel={onCancel} onConfirm={onConfirm} />)
      fireEvent.keyDown(document, { key: 'Escape' })
      expect(onCancel).toHaveBeenCalledTimes(1)
      expect(onConfirm).not.toHaveBeenCalled()
    })

    it('Enter keyboard event works', () => {
      render(<Confirm isShow={true} title="test title" onCancel={onCancel} onConfirm={onConfirm} />)
      fireEvent.keyDown(document, { key: 'Enter' })
      expect(onConfirm).toHaveBeenCalledTimes(1)
      expect(onCancel).not.toHaveBeenCalled()
    })
  })
})
