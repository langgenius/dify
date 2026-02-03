import { fireEvent, render, screen } from '@testing-library/react'
import AnnotationFullModal from './modal'

vi.mock('./usage', () => ({
  default: (props: { className?: string }) => {
    return (
      <div data-testid="usage-component" data-classname={props.className ?? ''}>
        usage
      </div>
    )
  },
}))

let mockUpgradeBtnProps: { loc?: string } | null = null
vi.mock('../upgrade-btn', () => ({
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
vi.mock('../../base/modal', () => ({
  default: ({ isShow, children, onClose, closable, className }: { isShow: boolean, children: React.ReactNode, onClose: () => void, closable?: boolean, className?: string }) => {
    mockModalProps = {
      isShow,
      closable,
      className,
    }
    if (!isShow)
      return null
    return (
      <div data-testid="annotation-full-modal" data-classname={className ?? ''}>
        {closable && (
          <button type="button" data-testid="mock-modal-close" onClick={onClose}>
            close
          </button>
        )}
        {children}
      </div>
    )
  },
}))

describe('AnnotationFullModal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUpgradeBtnProps = null
    mockModalProps = null
  })

  // Rendering marketing copy inside modal
  describe('Rendering', () => {
    it('should display main info when visible', () => {
      // Act
      render(<AnnotationFullModal show onHide={vi.fn()} />)

      // Assert
      expect(screen.getByText('billing.annotatedResponse.fullTipLine1')).toBeInTheDocument()
      expect(screen.getByText('billing.annotatedResponse.fullTipLine2')).toBeInTheDocument()
      expect(screen.getByTestId('usage-component')).toHaveAttribute('data-classname', 'mt-4')
      expect(screen.getByTestId('upgrade-btn')).toHaveTextContent('annotation-create')
      expect(mockUpgradeBtnProps?.loc).toBe('annotation-create')
      expect(mockModalProps).toEqual(expect.objectContaining({
        isShow: true,
        closable: true,
        className: '!p-0',
      }))
    })
  })

  // Controlling modal visibility
  describe('Visibility', () => {
    it('should not render content when hidden', () => {
      // Act
      const { container } = render(<AnnotationFullModal show={false} onHide={vi.fn()} />)

      // Assert
      expect(container).toBeEmptyDOMElement()
      expect(mockModalProps).toEqual(expect.objectContaining({ isShow: false }))
    })
  })

  // Handling close interactions
  describe('Close handling', () => {
    it('should trigger onHide when close control is clicked', () => {
      // Arrange
      const onHide = vi.fn()

      // Act
      render(<AnnotationFullModal show onHide={onHide} />)
      fireEvent.click(screen.getByTestId('mock-modal-close'))

      // Assert
      expect(onHide).toHaveBeenCalledTimes(1)
    })
  })
})
