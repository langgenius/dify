import { render, screen } from '@testing-library/react'
import AnnotationFull from './index'

vi.mock('./usage', () => ({
  default: (props: { className?: string }) => {
    return (
      <div data-testid="usage-component" data-classname={props.className ?? ''}>
        usage
      </div>
    )
  },
}))

vi.mock('../upgrade-btn', () => ({
  default: (props: { loc?: string }) => {
    return (
      <button type="button" data-testid="upgrade-btn">
        {props.loc}
      </button>
    )
  },
}))

describe('AnnotationFull', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // Rendering marketing copy with action button
  describe('Rendering', () => {
    it('should render tips when rendered', () => {
      // Act
      render(<AnnotationFull />)

      // Assert
      expect(screen.getByText('billing.annotatedResponse.fullTipLine1')).toBeInTheDocument()
      expect(screen.getByText('billing.annotatedResponse.fullTipLine2')).toBeInTheDocument()
    })

    it('should render upgrade button when rendered', () => {
      // Act
      render(<AnnotationFull />)

      // Assert
      expect(screen.getByTestId('upgrade-btn')).toBeInTheDocument()
    })

    it('should render Usage component when rendered', () => {
      // Act
      render(<AnnotationFull />)

      // Assert
      const usageComponent = screen.getByTestId('usage-component')
      expect(usageComponent).toBeInTheDocument()
    })
  })
})
