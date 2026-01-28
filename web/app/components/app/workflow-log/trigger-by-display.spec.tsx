/**
 * TriggerByDisplay Component Tests
 *
 * Tests the display of workflow trigger sources with appropriate icons and labels.
 * Covers all trigger types: app-run, debugging, webhook, schedule, plugin, rag-pipeline.
 */

import type { TriggerMetadata } from '@/models/log'
import { render, screen } from '@testing-library/react'
import { WorkflowRunTriggeredFrom } from '@/models/log'
import { Theme } from '@/types/app'
import TriggerByDisplay from './trigger-by-display'

// ============================================================================
// Mocks
// ============================================================================

let mockTheme = Theme.light
vi.mock('@/hooks/use-theme', () => ({
  default: () => ({ theme: mockTheme }),
}))

// Mock BlockIcon as it has complex dependencies
vi.mock('@/app/components/workflow/block-icon', () => ({
  default: ({ type, toolIcon }: { type: string, toolIcon?: string }) => (
    <div data-testid="block-icon" data-type={type} data-tool-icon={toolIcon || ''}>
      BlockIcon
    </div>
  ),
}))

// ============================================================================
// Test Data Factories
// ============================================================================

const createTriggerMetadata = (overrides: Partial<TriggerMetadata> = {}): TriggerMetadata => ({
  ...overrides,
})

// ============================================================================
// Tests
// ============================================================================

describe('TriggerByDisplay', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockTheme = Theme.light
  })

  // --------------------------------------------------------------------------
  // Rendering Tests (REQUIRED)
  // --------------------------------------------------------------------------
  describe('Rendering', () => {
    it('should render without crashing', () => {
      render(<TriggerByDisplay triggeredFrom={WorkflowRunTriggeredFrom.APP_RUN} />)

      expect(screen.getByText('appLog.triggerBy.appRun')).toBeInTheDocument()
    })

    it('should render icon container', () => {
      const { container } = render(
        <TriggerByDisplay triggeredFrom={WorkflowRunTriggeredFrom.APP_RUN} />,
      )

      // Should have icon container with flex layout
      const iconContainer = container.querySelector('.flex.items-center.justify-center')
      expect(iconContainer).toBeInTheDocument()
    })
  })

  // --------------------------------------------------------------------------
  // Props Tests (REQUIRED)
  // --------------------------------------------------------------------------
  describe('Props', () => {
    it('should apply custom className', () => {
      const { container } = render(
        <TriggerByDisplay
          triggeredFrom={WorkflowRunTriggeredFrom.APP_RUN}
          className="custom-class"
        />,
      )

      const wrapper = container.firstChild as HTMLElement
      expect(wrapper).toHaveClass('custom-class')
    })

    it('should show text by default (showText defaults to true)', () => {
      render(<TriggerByDisplay triggeredFrom={WorkflowRunTriggeredFrom.APP_RUN} />)

      expect(screen.getByText('appLog.triggerBy.appRun')).toBeInTheDocument()
    })

    it('should hide text when showText is false', () => {
      render(
        <TriggerByDisplay
          triggeredFrom={WorkflowRunTriggeredFrom.APP_RUN}
          showText={false}
        />,
      )

      expect(screen.queryByText('appLog.triggerBy.appRun')).not.toBeInTheDocument()
    })
  })

  // --------------------------------------------------------------------------
  // Trigger Type Display Tests
  // --------------------------------------------------------------------------
  describe('Trigger Types', () => {
    it('should display app-run trigger correctly', () => {
      render(<TriggerByDisplay triggeredFrom={WorkflowRunTriggeredFrom.APP_RUN} />)

      expect(screen.getByText('appLog.triggerBy.appRun')).toBeInTheDocument()
    })

    it('should display debugging trigger correctly', () => {
      render(<TriggerByDisplay triggeredFrom={WorkflowRunTriggeredFrom.DEBUGGING} />)

      expect(screen.getByText('appLog.triggerBy.debugging')).toBeInTheDocument()
    })

    it('should display webhook trigger correctly', () => {
      render(<TriggerByDisplay triggeredFrom={WorkflowRunTriggeredFrom.WEBHOOK} />)

      expect(screen.getByText('appLog.triggerBy.webhook')).toBeInTheDocument()
    })

    it('should display schedule trigger correctly', () => {
      render(<TriggerByDisplay triggeredFrom={WorkflowRunTriggeredFrom.SCHEDULE} />)

      expect(screen.getByText('appLog.triggerBy.schedule')).toBeInTheDocument()
    })

    it('should display plugin trigger correctly', () => {
      render(<TriggerByDisplay triggeredFrom={WorkflowRunTriggeredFrom.PLUGIN} />)

      expect(screen.getByText('appLog.triggerBy.plugin')).toBeInTheDocument()
    })

    it('should display rag-pipeline-run trigger correctly', () => {
      render(<TriggerByDisplay triggeredFrom={WorkflowRunTriggeredFrom.RAG_PIPELINE_RUN} />)

      expect(screen.getByText('appLog.triggerBy.ragPipelineRun')).toBeInTheDocument()
    })

    it('should display rag-pipeline-debugging trigger correctly', () => {
      render(<TriggerByDisplay triggeredFrom={WorkflowRunTriggeredFrom.RAG_PIPELINE_DEBUGGING} />)

      expect(screen.getByText('appLog.triggerBy.ragPipelineDebugging')).toBeInTheDocument()
    })
  })

  // --------------------------------------------------------------------------
  // Plugin Metadata Tests
  // --------------------------------------------------------------------------
  describe('Plugin Metadata', () => {
    it('should display custom event name from plugin metadata', () => {
      const metadata = createTriggerMetadata({ event_name: 'Custom Plugin Event' })

      render(
        <TriggerByDisplay
          triggeredFrom={WorkflowRunTriggeredFrom.PLUGIN}
          triggerMetadata={metadata}
        />,
      )

      expect(screen.getByText('Custom Plugin Event')).toBeInTheDocument()
    })

    it('should fallback to default plugin text when no event_name', () => {
      const metadata = createTriggerMetadata({})

      render(
        <TriggerByDisplay
          triggeredFrom={WorkflowRunTriggeredFrom.PLUGIN}
          triggerMetadata={metadata}
        />,
      )

      expect(screen.getByText('appLog.triggerBy.plugin')).toBeInTheDocument()
    })

    it('should use plugin icon from metadata in light theme', () => {
      mockTheme = Theme.light
      const metadata = createTriggerMetadata({ icon: 'light-icon.png', icon_dark: 'dark-icon.png' })

      render(
        <TriggerByDisplay
          triggeredFrom={WorkflowRunTriggeredFrom.PLUGIN}
          triggerMetadata={metadata}
        />,
      )

      const blockIcon = screen.getByTestId('block-icon')
      expect(blockIcon).toHaveAttribute('data-tool-icon', 'light-icon.png')
    })

    it('should use dark plugin icon in dark theme', () => {
      mockTheme = Theme.dark
      const metadata = createTriggerMetadata({ icon: 'light-icon.png', icon_dark: 'dark-icon.png' })

      render(
        <TriggerByDisplay
          triggeredFrom={WorkflowRunTriggeredFrom.PLUGIN}
          triggerMetadata={metadata}
        />,
      )

      const blockIcon = screen.getByTestId('block-icon')
      expect(blockIcon).toHaveAttribute('data-tool-icon', 'dark-icon.png')
    })

    it('should fallback to light icon when dark icon not available in dark theme', () => {
      mockTheme = Theme.dark
      const metadata = createTriggerMetadata({ icon: 'light-icon.png' })

      render(
        <TriggerByDisplay
          triggeredFrom={WorkflowRunTriggeredFrom.PLUGIN}
          triggerMetadata={metadata}
        />,
      )

      const blockIcon = screen.getByTestId('block-icon')
      expect(blockIcon).toHaveAttribute('data-tool-icon', 'light-icon.png')
    })

    it('should use default BlockIcon when plugin has no icon metadata', () => {
      const metadata = createTriggerMetadata({})

      render(
        <TriggerByDisplay
          triggeredFrom={WorkflowRunTriggeredFrom.PLUGIN}
          triggerMetadata={metadata}
        />,
      )

      const blockIcon = screen.getByTestId('block-icon')
      expect(blockIcon).toHaveAttribute('data-tool-icon', '')
    })
  })

  // --------------------------------------------------------------------------
  // Icon Rendering Tests
  // --------------------------------------------------------------------------
  describe('Icon Rendering', () => {
    it('should render WindowCursor icon for app-run trigger', () => {
      const { container } = render(
        <TriggerByDisplay triggeredFrom={WorkflowRunTriggeredFrom.APP_RUN} />,
      )

      // Check for the blue brand background used for app-run icon
      const iconWrapper = container.querySelector('.bg-util-colors-blue-brand-blue-brand-500')
      expect(iconWrapper).toBeInTheDocument()
    })

    it('should render Code icon for debugging trigger', () => {
      const { container } = render(
        <TriggerByDisplay triggeredFrom={WorkflowRunTriggeredFrom.DEBUGGING} />,
      )

      // Check for the blue background used for debugging icon
      const iconWrapper = container.querySelector('.bg-util-colors-blue-blue-500')
      expect(iconWrapper).toBeInTheDocument()
    })

    it('should render WebhookLine icon for webhook trigger', () => {
      const { container } = render(
        <TriggerByDisplay triggeredFrom={WorkflowRunTriggeredFrom.WEBHOOK} />,
      )

      // Check for the blue background used for webhook icon
      const iconWrapper = container.querySelector('.bg-util-colors-blue-blue-500')
      expect(iconWrapper).toBeInTheDocument()
    })

    it('should render Schedule icon for schedule trigger', () => {
      const { container } = render(
        <TriggerByDisplay triggeredFrom={WorkflowRunTriggeredFrom.SCHEDULE} />,
      )

      // Check for the violet background used for schedule icon
      const iconWrapper = container.querySelector('.bg-util-colors-violet-violet-500')
      expect(iconWrapper).toBeInTheDocument()
    })

    it('should render KnowledgeRetrieval icon for rag-pipeline triggers', () => {
      const { container } = render(
        <TriggerByDisplay triggeredFrom={WorkflowRunTriggeredFrom.RAG_PIPELINE_RUN} />,
      )

      // Check for the green background used for rag pipeline icon
      const iconWrapper = container.querySelector('.bg-util-colors-green-green-500')
      expect(iconWrapper).toBeInTheDocument()
    })
  })

  // --------------------------------------------------------------------------
  // Edge Cases (REQUIRED)
  // --------------------------------------------------------------------------
  describe('Edge Cases', () => {
    it('should handle unknown trigger type gracefully', () => {
      // Test with a type cast to simulate unknown trigger type
      render(<TriggerByDisplay triggeredFrom={'unknown-type' as WorkflowRunTriggeredFrom} />)

      // Should fallback to default (app-run) icon styling
      expect(screen.getByText('unknown-type')).toBeInTheDocument()
    })

    it('should handle undefined triggerMetadata', () => {
      render(
        <TriggerByDisplay
          triggeredFrom={WorkflowRunTriggeredFrom.PLUGIN}
          triggerMetadata={undefined}
        />,
      )

      expect(screen.getByText('appLog.triggerBy.plugin')).toBeInTheDocument()
    })

    it('should handle empty className', () => {
      const { container } = render(
        <TriggerByDisplay
          triggeredFrom={WorkflowRunTriggeredFrom.APP_RUN}
          className=""
        />,
      )

      const wrapper = container.firstChild as HTMLElement
      expect(wrapper).toHaveClass('flex', 'items-center', 'gap-1.5')
    })

    it('should render correctly when both showText is false and metadata is provided', () => {
      const metadata = createTriggerMetadata({ event_name: 'Test Event' })

      render(
        <TriggerByDisplay
          triggeredFrom={WorkflowRunTriggeredFrom.PLUGIN}
          triggerMetadata={metadata}
          showText={false}
        />,
      )

      // Text should not be visible even with metadata
      expect(screen.queryByText('Test Event')).not.toBeInTheDocument()
      expect(screen.queryByText('appLog.triggerBy.plugin')).not.toBeInTheDocument()
    })
  })

  // --------------------------------------------------------------------------
  // Theme Switching Tests
  // --------------------------------------------------------------------------
  describe('Theme Switching', () => {
    it('should render correctly in light theme', () => {
      mockTheme = Theme.light

      render(<TriggerByDisplay triggeredFrom={WorkflowRunTriggeredFrom.APP_RUN} />)

      expect(screen.getByText('appLog.triggerBy.appRun')).toBeInTheDocument()
    })

    it('should render correctly in dark theme', () => {
      mockTheme = Theme.dark

      render(<TriggerByDisplay triggeredFrom={WorkflowRunTriggeredFrom.APP_RUN} />)

      expect(screen.getByText('appLog.triggerBy.appRun')).toBeInTheDocument()
    })
  })
})
