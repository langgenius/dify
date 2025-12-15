import { render, screen } from '@testing-library/react'
import AnnotationFull from './index'

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

let mockUsageProps: { className?: string } | null = null
jest.mock('./usage', () => ({
  __esModule: true,
  default: (props: { className?: string }) => {
    mockUsageProps = props
    return (
      <div data-testid='usage-component' data-classname={props.className ?? ''}>
        usage
      </div>
    )
  },
}))

let mockUpgradeBtnProps: { loc?: string } | null = null
jest.mock('../upgrade-btn', () => ({
  __esModule: true,
  default: (props: { loc?: string }) => {
    mockUpgradeBtnProps = props
    return (
      <button type='button' data-testid='upgrade-btn'>
        {props.loc}
      </button>
    )
  },
}))

describe('AnnotationFull', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockUsageProps = null
    mockUpgradeBtnProps = null
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

    it('should should render upgrade button when rendered', () => {
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
