import type { Mock } from 'vitest'
import { TooltipProvider } from '@langgenius/dify-ui/tooltip'
import { render, screen } from '@testing-library/react'
import { createMockPlan } from '@/__mocks__/provider-context'
import { useProviderContext } from '@/context/provider-context'
import { Plan } from '../../type'
import PriorityLabel from '../index'

vi.mock('@/context/provider-context', () => ({
  useProviderContext: vi.fn(),
}))

const useProviderContextMock = useProviderContext as Mock

const setupPlan = (planType: Plan) => {
  useProviderContextMock.mockReturnValue(createMockPlan(planType))
}

const renderPriorityLabel = (className?: string) => {
  return render(
    <TooltipProvider delay={0} closeDelay={0}>
      <PriorityLabel className={className} />
    </TooltipProvider>,
  )
}

describe('PriorityLabel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Rendering', () => {
    it('should render the standard priority label when plan is sandbox', () => {
      setupPlan(Plan.sandbox)

      renderPriorityLabel()

      expect(screen.getByText('billing.plansCommon.priority.standard')).toBeInTheDocument()
    })
  })

  // Props: custom class name applied to the label container.
  describe('Props', () => {
    it('should apply custom className to the label container', () => {
      setupPlan(Plan.sandbox)

      renderPriorityLabel('custom-class')

      const label = screen.getByText('billing.plansCommon.priority.standard').closest('div')
      expect(label).toHaveClass('custom-class')
    })
  })

  // Plan types: label text and icon visibility for different plans.
  describe('Plan Types', () => {
    it('should render priority label and icon when plan is professional', () => {
      setupPlan(Plan.professional)

      const { container } = renderPriorityLabel()

      expect(screen.getByText('billing.plansCommon.priority.priority')).toBeInTheDocument()
      expect(container.querySelector('svg')).toBeInTheDocument()
    })

    it('should render top priority label and icon when plan is team', () => {
      setupPlan(Plan.team)

      const { container } = renderPriorityLabel()

      expect(screen.getByText('billing.plansCommon.priority.top-priority')).toBeInTheDocument()
      expect(container.querySelector('svg')).toBeInTheDocument()
    })

    it('should render standard label without icon when plan is sandbox', () => {
      setupPlan(Plan.sandbox)

      const { container } = renderPriorityLabel()

      expect(screen.getByText('billing.plansCommon.priority.standard')).toBeInTheDocument()
      expect(container.querySelector('svg')).not.toBeInTheDocument()
    })
  })

  // Enterprise plan tests
  describe('Enterprise Plan', () => {
    it('should render top-priority label with icon for enterprise plan', () => {
      setupPlan(Plan.enterprise)

      const { container } = renderPriorityLabel()

      expect(screen.getByText('billing.plansCommon.priority.top-priority')).toBeInTheDocument()
      expect(container.querySelector('svg')).toBeInTheDocument()
    })
  })

  describe('Edge Cases', () => {
    it('should render a non-top priority trigger without mounting tooltip content by default', () => {
      setupPlan(Plan.sandbox)

      renderPriorityLabel()

      expect(screen.getByText('billing.plansCommon.priority.standard')).toBeInTheDocument()
      expect(screen.queryByText('billing.plansCommon.documentProcessingPriority')).not.toBeInTheDocument()
    })

    it('should render a top priority trigger without mounting upgrade tip by default', () => {
      setupPlan(Plan.enterprise)

      renderPriorityLabel()

      expect(screen.getByText('billing.plansCommon.priority.top-priority')).toBeInTheDocument()
      expect(screen.queryByText('billing.plansCommon.documentProcessingPriorityTip')).not.toBeInTheDocument()
    })
  })
})
