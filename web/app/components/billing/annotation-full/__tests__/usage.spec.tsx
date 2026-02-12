import { render, screen } from '@testing-library/react'
import Usage from '../usage'

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
  describe('Rendering', () => {
    it('should render usage info with data from provider context', () => {
      render(<Usage />)

      expect(screen.getByText('billing.annotatedResponse.quotaTitle')).toBeInTheDocument()
    })

    it('should pass className to UsageInfo component', () => {
      const testClassName = 'mt-4'

      const { container } = render(<Usage className={testClassName} />)

      const wrapper = container.firstChild as HTMLElement
      expect(wrapper).toHaveClass(testClassName)
    })

    it('should display usage and total values from context', () => {
      render(<Usage />)

      expect(screen.getByText('50')).toBeInTheDocument()
      expect(screen.getByText('100')).toBeInTheDocument()
    })
  })
})
