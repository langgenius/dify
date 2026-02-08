import { render, screen } from '@testing-library/react'
import { defaultPlan } from '../config'
import { Plan } from '../type'
import VectorSpaceInfo from './vector-space-info'

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

    it('should render indeterminate progress bar when usage is below threshold', () => {
      render(<VectorSpaceInfo />)

      expect(screen.getByTestId('billing-progress-bar-indeterminate')).toBeInTheDocument()
    })

    it('should render full-width indeterminate bar for sandbox users', () => {
      render(<VectorSpaceInfo />)

      const bar = screen.getByTestId('billing-progress-bar-indeterminate')
      expect(bar).toHaveClass('w-full')
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

    it('should render error color progress bar when at full capacity', () => {
      render(<VectorSpaceInfo />)

      const progressBar = screen.getByTestId('billing-progress-bar')
      expect(progressBar).toHaveClass('bg-components-progress-error-progress')
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

    it('should render indeterminate progress bar when usage is below threshold', () => {
      render(<VectorSpaceInfo />)

      expect(screen.getByTestId('billing-progress-bar-indeterminate')).toBeInTheDocument()
    })

    it('should render narrow indeterminate bar (not full width)', () => {
      render(<VectorSpaceInfo />)

      const bar = screen.getByTestId('billing-progress-bar-indeterminate')
      expect(bar).toHaveClass('w-[30px]')
      expect(bar).not.toHaveClass('w-full')
    })

    it('should display "< 50 / total" format when below threshold', () => {
      render(<VectorSpaceInfo />)

      expect(screen.getByText(/< 50/)).toBeInTheDocument()
      // 5 GB = 5120 MB
      expect(screen.getByText('5120MB')).toBeInTheDocument()
    })
  })

  describe('Professional Plan Above Threshold', () => {
    beforeEach(() => {
      mockPlanType = Plan.professional
      mockVectorSpaceUsage = 100
    })

    it('should render normal progress bar when usage >= threshold', () => {
      render(<VectorSpaceInfo />)

      expect(screen.getByTestId('billing-progress-bar')).toBeInTheDocument()
      expect(screen.queryByTestId('billing-progress-bar-indeterminate')).not.toBeInTheDocument()
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

    it('should render indeterminate progress bar when usage is below threshold', () => {
      render(<VectorSpaceInfo />)

      expect(screen.getByTestId('billing-progress-bar-indeterminate')).toBeInTheDocument()
    })

    it('should render narrow indeterminate bar (not full width)', () => {
      render(<VectorSpaceInfo />)

      const bar = screen.getByTestId('billing-progress-bar-indeterminate')
      expect(bar).toHaveClass('w-[30px]')
      expect(bar).not.toHaveClass('w-full')
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

    it('should render normal progress bar when usage >= threshold', () => {
      render(<VectorSpaceInfo />)

      expect(screen.getByTestId('billing-progress-bar')).toBeInTheDocument()
      expect(screen.queryByTestId('billing-progress-bar-indeterminate')).not.toBeInTheDocument()
    })

    it('should display actual usage when above threshold', () => {
      render(<VectorSpaceInfo />)

      expect(screen.getByText('100')).toBeInTheDocument()
      expect(screen.getByText('20480MB')).toBeInTheDocument()
    })
  })

  describe('Pro/Team Plan Warning State', () => {
    it('should show warning color when Professional plan usage approaches limit (80%+)', () => {
      mockPlanType = Plan.professional
      // 5120 MB * 80% = 4096 MB
      mockVectorSpaceUsage = 4100

      render(<VectorSpaceInfo />)

      const progressBar = screen.getByTestId('billing-progress-bar')
      expect(progressBar).toHaveClass('bg-components-progress-warning-progress')
    })

    it('should show warning color when Team plan usage approaches limit (80%+)', () => {
      mockPlanType = Plan.team
      // 20480 MB * 80% = 16384 MB
      mockVectorSpaceUsage = 16500

      render(<VectorSpaceInfo />)

      const progressBar = screen.getByTestId('billing-progress-bar')
      expect(progressBar).toHaveClass('bg-components-progress-warning-progress')
    })
  })

  describe('Pro/Team Plan Error State', () => {
    it('should show error color when Professional plan usage exceeds limit', () => {
      mockPlanType = Plan.professional
      // Exceeds 5120 MB
      mockVectorSpaceUsage = 5200

      render(<VectorSpaceInfo />)

      const progressBar = screen.getByTestId('billing-progress-bar')
      expect(progressBar).toHaveClass('bg-components-progress-error-progress')
    })

    it('should show error color when Team plan usage exceeds limit', () => {
      mockPlanType = Plan.team
      // Exceeds 20480 MB
      mockVectorSpaceUsage = 21000

      render(<VectorSpaceInfo />)

      const progressBar = screen.getByTestId('billing-progress-bar')
      expect(progressBar).toHaveClass('bg-components-progress-error-progress')
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

    it('should render indeterminate progress bar when usage is below threshold', () => {
      render(<VectorSpaceInfo />)

      expect(screen.getByTestId('billing-progress-bar-indeterminate')).toBeInTheDocument()
    })

    it('should render narrow indeterminate bar (not full width) for enterprise', () => {
      render(<VectorSpaceInfo />)

      const bar = screen.getByTestId('billing-progress-bar-indeterminate')
      expect(bar).toHaveClass('w-[30px]')
      expect(bar).not.toHaveClass('w-full')
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

    it('should render normal progress bar when usage >= threshold', () => {
      render(<VectorSpaceInfo />)

      expect(screen.getByTestId('billing-progress-bar')).toBeInTheDocument()
      expect(screen.queryByTestId('billing-progress-bar-indeterminate')).not.toBeInTheDocument()
    })

    it('should display actual usage when above threshold', () => {
      render(<VectorSpaceInfo />)

      expect(screen.getByText('100')).toBeInTheDocument()
      expect(screen.getByText('102400MB')).toBeInTheDocument()
    })
  })
})
