import { render, screen } from '@testing-library/react'
import { defaultPlan } from '../../config'
import { Plan } from '../../type'
import VectorSpaceInfo from '../vector-space-info'

const queryPlaceholder = () =>
  document.body.querySelector('[aria-hidden="true"].bg-components-progress-bar-bg')

// Mock provider context with configurable plan
let mockPlanType = Plan.sandbox
let mockVectorSpaceUsage = 30
let mockVectorSpaceTotal = 5120

vi.mock('@/context/provider-context', () => ({
  useProviderContext: () => ({
    plan: {
      ...defaultPlan,
      type: mockPlanType,
      usage: {
        ...defaultPlan.usage,
        vectorSpace: mockVectorSpaceUsage,
      },
      total: {
        ...defaultPlan.total,
        vectorSpace: mockVectorSpaceTotal,
      },
    },
  }),
}))

describe('VectorSpaceInfo', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Reset to default values
    mockPlanType = Plan.sandbox
    mockVectorSpaceUsage = 30
    mockVectorSpaceTotal = 5120
  })

  describe('Rendering', () => {
    it('should render vector space info component', () => {
      render(<VectorSpaceInfo />)

      expect(screen.getByText('billing.usagePage.vectorSpace')).toBeInTheDocument()
    })

    it('should apply custom className', () => {
      render(<VectorSpaceInfo className="custom-class" />)

      const container = screen.getByText('billing.usagePage.vectorSpace').closest('.custom-class')
      expect(container).toBeInTheDocument()
    })
  })

  describe('Sandbox Plan', () => {
    beforeEach(() => {
      mockPlanType = Plan.sandbox
      mockVectorSpaceUsage = 30
    })

    it('should render the redacted placeholder when usage is below threshold', () => {
      render(<VectorSpaceInfo />)

      expect(queryPlaceholder()).toBeInTheDocument()
      expect(screen.queryByRole('meter')).not.toBeInTheDocument()
    })

    it('should display "< 50" format for sandbox below threshold', () => {
      render(<VectorSpaceInfo />)

      expect(screen.getByText(/< 50/)).toBeInTheDocument()
    })
  })

  describe('Sandbox Plan at Full Capacity', () => {
    beforeEach(() => {
      mockPlanType = Plan.sandbox
      mockVectorSpaceUsage = 50
    })

    it('should render the Meter when at full capacity', () => {
      render(<VectorSpaceInfo />)

      expect(screen.getByRole('meter')).toBeInTheDocument()
      expect(queryPlaceholder()).toBeNull()
    })

    it('should display "50 / 50 MB" format when at full capacity', () => {
      render(<VectorSpaceInfo />)

      expect(screen.getByText('50')).toBeInTheDocument()
      expect(screen.getByText(/50 MB/)).toBeInTheDocument()
    })
  })

  describe('Professional Plan', () => {
    beforeEach(() => {
      mockPlanType = Plan.professional
      mockVectorSpaceUsage = 30
    })

    it('should render the redacted placeholder when usage is below threshold', () => {
      render(<VectorSpaceInfo />)

      expect(queryPlaceholder()).toBeInTheDocument()
      expect(screen.queryByRole('meter')).not.toBeInTheDocument()
    })

    it('should display "< 50 / total" format when below threshold', () => {
      render(<VectorSpaceInfo />)

      expect(screen.getByText(/< 50/)).toBeInTheDocument()
      expect(screen.getByText('5120MB')).toBeInTheDocument()
    })
  })

  describe('Professional Plan Above Threshold', () => {
    beforeEach(() => {
      mockPlanType = Plan.professional
      mockVectorSpaceUsage = 100
    })

    it('should render the Meter when usage >= threshold', () => {
      render(<VectorSpaceInfo />)

      expect(screen.getByRole('meter')).toBeInTheDocument()
      expect(queryPlaceholder()).toBeNull()
    })

    it('should display actual usage when above threshold', () => {
      render(<VectorSpaceInfo />)

      expect(screen.getByText('100')).toBeInTheDocument()
      expect(screen.getByText('5120MB')).toBeInTheDocument()
    })
  })

  describe('Team Plan', () => {
    beforeEach(() => {
      mockPlanType = Plan.team
      mockVectorSpaceUsage = 30
    })

    it('should render the redacted placeholder when usage is below threshold', () => {
      render(<VectorSpaceInfo />)

      expect(queryPlaceholder()).toBeInTheDocument()
      expect(screen.queryByRole('meter')).not.toBeInTheDocument()
    })

    it('should display "< 50 / total" format when below threshold', () => {
      render(<VectorSpaceInfo />)

      expect(screen.getByText(/< 50/)).toBeInTheDocument()
      // 20 GB = 20480 MB
      expect(screen.getByText('20480MB')).toBeInTheDocument()
    })
  })

  describe('Team Plan Above Threshold', () => {
    beforeEach(() => {
      mockPlanType = Plan.team
      mockVectorSpaceUsage = 100
    })

    it('should render the Meter when usage >= threshold', () => {
      render(<VectorSpaceInfo />)

      expect(screen.getByRole('meter')).toBeInTheDocument()
      expect(queryPlaceholder()).toBeNull()
    })

    it('should display actual usage when above threshold', () => {
      render(<VectorSpaceInfo />)

      expect(screen.getByText('100')).toBeInTheDocument()
      expect(screen.getByText('20480MB')).toBeInTheDocument()
    })
  })

  describe('Pro/Team Plan Usage States', () => {
    const findToneClass = (usage: number) => {
      mockPlanType = Plan.professional
      mockVectorSpaceUsage = usage
      const { container, unmount } = render(<VectorSpaceInfo />)
      const indicator = container.querySelector(
        '[class*="bg-components-progress-"]:not([class*="progress-bar-bg"])',
      )
      const className = indicator?.className ?? ''
      unmount()
      return className
    }

    it('should apply neutral / warning / error tone at distinct usage levels', () => {
      const normalClass = findToneClass(100)
      const warningClass = findToneClass(4100)
      const errorClass = findToneClass(5200)

      expect(normalClass).toContain('bg-components-progress-bar-progress-solid')
      expect(warningClass).toContain('bg-components-progress-warning-progress')
      expect(errorClass).toContain('bg-components-progress-error-progress')
    })
  })

  describe('Enterprise Plan (default case)', () => {
    beforeEach(() => {
      mockPlanType = Plan.enterprise
      mockVectorSpaceUsage = 30
      // Enterprise plan uses total.vectorSpace from context
      mockVectorSpaceTotal = 102400 // 100 GB = 102400 MB
    })

    it('should use total.vectorSpace from context for enterprise plan', () => {
      render(<VectorSpaceInfo />)

      // Enterprise plan should use the mockVectorSpaceTotal value (102400MB)
      expect(screen.getByText('102400MB')).toBeInTheDocument()
    })

    it('should render the redacted placeholder when usage is below threshold', () => {
      render(<VectorSpaceInfo />)

      expect(queryPlaceholder()).toBeInTheDocument()
      expect(screen.queryByRole('meter')).not.toBeInTheDocument()
    })

    it('should display "< 50 / total" format when below threshold', () => {
      render(<VectorSpaceInfo />)

      expect(screen.getByText(/< 50/)).toBeInTheDocument()
      expect(screen.getByText('102400MB')).toBeInTheDocument()
    })
  })

  describe('Enterprise Plan Above Threshold', () => {
    beforeEach(() => {
      mockPlanType = Plan.enterprise
      mockVectorSpaceUsage = 100
      mockVectorSpaceTotal = 102400 // 100 GB
    })

    it('should render the Meter when usage >= threshold', () => {
      render(<VectorSpaceInfo />)

      expect(screen.getByRole('meter')).toBeInTheDocument()
      expect(queryPlaceholder()).toBeNull()
    })

    it('should display actual usage when above threshold', () => {
      render(<VectorSpaceInfo />)

      expect(screen.getByText('100')).toBeInTheDocument()
      expect(screen.getByText('102400MB')).toBeInTheDocument()
    })
  })
})
