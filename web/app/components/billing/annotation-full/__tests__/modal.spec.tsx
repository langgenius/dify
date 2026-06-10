import { fireEvent, render, screen } from '@testing-library/react'
import AnnotationFullModal from '../modal'

vi.mock('../usage', () => ({
  default: (props: { className?: string }) => {
    return (
      <div data-testid="usage-component" data-classname={props.className ?? ''}>
        usage
      </div>
    )
  },
}))

let mockUpgradeBtnProps: { loc?: string } | null = null
vi.mock('../../upgrade-btn', () => ({
  default: (props: { loc?: string }) => {
    mockUpgradeBtnProps = props
    return (
      <button type="button" data-testid="upgrade-btn">
        {props.loc}
      </button>
    )
  },
}))

type ModalSnapshot = {
  isShow: boolean
  closable?: boolean
  className?: string
}
let mockModalProps: ModalSnapshot | null = null
let mockOnOpenChange: ((open: boolean) => void) | undefined
vi.mock('@langgenius/dify-ui/dialog', () => ({
  Dialog: ({ open, onOpenChange, children }: { open?: boolean, onOpenChange?: (open: boolean) => void, children: React.ReactNode }) => {
    mockOnOpenChange = onOpenChange
    mockModalProps = { isShow: open !== false }
    return open === false ? null : <>{children}</>
  },
  DialogContent: ({ children, className }: { children: React.ReactNode, className?: string }) => {
    mockModalProps = {
      isShow: true,
      closable: true,
      className,
    }
    return (
      <div data-testid="annotation-full-modal" data-classname={className ?? ''}>
        {children}
      </div>
    )
  },
  DialogCloseButton: () => <button type="button" data-testid="mock-modal-close" onClick={() => mockOnOpenChange?.(false)}>close</button>,
}))

describe('AnnotationFullModal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUpgradeBtnProps = null
    mockModalProps = null
    mockOnOpenChange = undefined
  })

  // Rendering marketing copy inside modal
  describe('Rendering', () => {
    it('should display main info when visible', () => {
      render(<AnnotationFullModal show onHide={vi.fn()} />)

      expect(screen.getByText('billing.annotatedResponse.fullTipLine1')).toBeInTheDocument()
      expect(screen.getByText('billing.annotatedResponse.fullTipLine2')).toBeInTheDocument()
      expect(screen.getByTestId('usage-component')).toHaveAttribute('data-classname', 'mt-4')
      expect(screen.getByTestId('upgrade-btn')).toHaveTextContent('annotation-create')
      expect(mockUpgradeBtnProps?.loc).toBe('annotation-create')
      expect(mockModalProps).toEqual(expect.objectContaining({
        isShow: true,
        closable: true,
        className: expect.stringContaining('p-0!'),
      }))
      expect(mockModalProps?.className).toContain('w-full')
    })
  })

  // Controlling modal visibility
  describe('Visibility', () => {
    it('should not render content when hidden', () => {
      const { container } = render(<AnnotationFullModal show={false} onHide={vi.fn()} />)

      expect(container).toBeEmptyDOMElement()
      expect(mockModalProps).toEqual(expect.objectContaining({ isShow: false }))
    })
  })

  // Handling close interactions
  describe('Close handling', () => {
    it('should trigger onHide when close control is clicked', () => {
      const onHide = vi.fn()

      render(<AnnotationFullModal show onHide={onHide} />)
      fireEvent.click(screen.getByTestId('mock-modal-close'))

      expect(onHide).toHaveBeenCalledTimes(1)
    })
  })
})
