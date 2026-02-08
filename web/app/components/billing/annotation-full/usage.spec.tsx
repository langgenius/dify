import { render, screen } from '@testing-library/react'
import Usage from './usage'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

const mockPlan = {
  usage: {
    annotatedResponse: 50,
  },
  total: {
    annotatedResponse: 100,
  },
}

vi.mock('@/context/provider-context', () => ({
  useProviderContext: () => ({
    plan: mockPlan,
  }),
}))

describe('Usage', () => {
  // Rendering: renders UsageInfo with correct props from context
  describe('Rendering', () => {
    it('should render usage info with data from provider context', () => {
      // Arrange & Act
      render(<Usage />)

      // Assert
      expect(screen.getByText('annotatedResponse.quotaTitle')).toBeInTheDocument()
    })

    it('should pass className to UsageInfo component', () => {
      // Arrange
      const testClassName = 'mt-4'

      // Act
      const { container } = render(<Usage className={testClassName} />)

      // Assert
      const wrapper = container.firstChild as HTMLElement
      expect(wrapper).toHaveClass(testClassName)
    })

    it('should display usage and total values from context', () => {
      // Arrange & Act
      render(<Usage />)

      // Assert
      expect(screen.getByText('50')).toBeInTheDocument()
      expect(screen.getByText('100')).toBeInTheDocument()
    })
  })
})
