import type { WorkflowRunningData } from '@/app/components/workflow/types'
import { fireEvent, render, screen } from '@testing-library/react'
import * as React from 'react'
import Tabs from './index'
import Tab from './tab'

// ============================================================================
// Mock External Dependencies
// ============================================================================

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { ns?: string }) => {
      const ns = options?.ns ? `${options.ns}.` : ''
      return `${ns}${key}`
    },
  }),
}))

// ============================================================================
// Test Data Factories
// ============================================================================

/**
 * Factory function to create mock WorkflowRunningData
 * Provides complete defaults with optional overrides for flexibility
 */
const createWorkflowRunningData = (
  overrides?: Partial<WorkflowRunningData>,
): WorkflowRunningData => ({
  task_id: 'test-task-id',
  message_id: 'test-message-id',
  conversation_id: 'test-conversation-id',
  result: {
    workflow_id: 'test-workflow-id',
    inputs: '{}',
    inputs_truncated: false,
    process_data: '{}',
    process_data_truncated: false,
    outputs: '{}',
    outputs_truncated: false,
    status: 'succeeded',
    elapsed_time: 1000,
    total_tokens: 100,
    created_at: Date.now(),
    finished_at: Date.now(),
    steps: 5,
    total_steps: 5,
    ...overrides?.result,
  },
  tracing: overrides?.tracing ?? [],
  ...overrides,
})

// ============================================================================
// Tab Component Tests
// ============================================================================

describe('Tab', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // -------------------------------------------------------------------------
  // Rendering Tests - Verify basic component rendering
  // -------------------------------------------------------------------------
  describe('Rendering', () => {
    it('should render tab with label correctly', () => {
      // Arrange
      const mockOnClick = vi.fn()
      const workflowData = createWorkflowRunningData()

      // Act
      render(
        <Tab
          isActive={false}
          label="Test Label"
          value="TEST"
          workflowRunningData={workflowData}
          onClick={mockOnClick}
        />,
      )

      // Assert
      expect(screen.getByRole('button', { name: 'Test Label' })).toBeInTheDocument()
    })

    it('should render as button element with correct type', () => {
      // Arrange
      const mockOnClick = vi.fn()
      const workflowData = createWorkflowRunningData()

      // Act
      render(
        <Tab
          isActive={false}
          label="Test"
          value="TEST"
          workflowRunningData={workflowData}
          onClick={mockOnClick}
        />,
      )

      // Assert
      const button = screen.getByRole('button')
      expect(button).toHaveAttribute('type', 'button')
    })
  })

  // -------------------------------------------------------------------------
  // Props Tests - Verify different prop combinations
  // -------------------------------------------------------------------------
  describe('Props', () => {
    describe('isActive prop', () => {
      it('should apply active styles when isActive is true', () => {
        // Arrange
        const mockOnClick = vi.fn()
        const workflowData = createWorkflowRunningData()

        // Act
        render(
          <Tab
            isActive={true}
            label="Active Tab"
            value="ACTIVE"
            workflowRunningData={workflowData}
            onClick={mockOnClick}
          />,
        )

        // Assert
        const button = screen.getByRole('button')
        expect(button).toHaveClass('border-util-colors-blue-brand-blue-brand-600')
        expect(button).toHaveClass('text-text-primary')
      })

      it('should apply inactive styles when isActive is false', () => {
        // Arrange
        const mockOnClick = vi.fn()
        const workflowData = createWorkflowRunningData()

        // Act
        render(
          <Tab
            isActive={false}
            label="Inactive Tab"
            value="INACTIVE"
            workflowRunningData={workflowData}
            onClick={mockOnClick}
          />,
        )

        // Assert
        const button = screen.getByRole('button')
        expect(button).toHaveClass('text-text-tertiary')
        expect(button).toHaveClass('border-transparent')
      })
    })

    describe('label prop', () => {
      it('should display the provided label text', () => {
        // Arrange
        const mockOnClick = vi.fn()
        const workflowData = createWorkflowRunningData()

        // Act
        render(
          <Tab
            isActive={false}
            label="Custom Label Text"
            value="TEST"
            workflowRunningData={workflowData}
            onClick={mockOnClick}
          />,
        )

        // Assert
        expect(screen.getByText('Custom Label Text')).toBeInTheDocument()
      })

      it('should handle empty label', () => {
        // Arrange
        const mockOnClick = vi.fn()
        const workflowData = createWorkflowRunningData()

        // Act
        render(
          <Tab
            isActive={false}
            label=""
            value="TEST"
            workflowRunningData={workflowData}
            onClick={mockOnClick}
          />,
        )

        // Assert
        expect(screen.getByRole('button')).toBeInTheDocument()
        expect(screen.getByRole('button')).toHaveTextContent('')
      })

      it('should handle long label text', () => {
        // Arrange
        const mockOnClick = vi.fn()
        const workflowData = createWorkflowRunningData()
        const longLabel = 'This is a very long label text for testing purposes'

        // Act
        render(
          <Tab
            isActive={false}
            label={longLabel}
            value="TEST"
            workflowRunningData={workflowData}
            onClick={mockOnClick}
          />,
        )

        // Assert
        expect(screen.getByText(longLabel)).toBeInTheDocument()
      })
    })

    describe('value prop', () => {
      it('should pass value to onClick handler when clicked', () => {
        // Arrange
        const mockOnClick = vi.fn()
        const workflowData = createWorkflowRunningData()
        const testValue = 'CUSTOM_VALUE'

        // Act
        render(
          <Tab
            isActive={false}
            label="Test"
            value={testValue}
            workflowRunningData={workflowData}
            onClick={mockOnClick}
          />,
        )
        fireEvent.click(screen.getByRole('button'))

        // Assert
        expect(mockOnClick).toHaveBeenCalledWith(testValue)
      })
    })

    describe('workflowRunningData prop', () => {
      it('should enable button when workflowRunningData is provided', () => {
        // Arrange
        const mockOnClick = vi.fn()
        const workflowData = createWorkflowRunningData()

        // Act
        render(
          <Tab
            isActive={false}
            label="Test"
            value="TEST"
            workflowRunningData={workflowData}
            onClick={mockOnClick}
          />,
        )

        // Assert
        expect(screen.getByRole('button')).not.toBeDisabled()
      })

      it('should disable button when workflowRunningData is undefined', () => {
        // Arrange
        const mockOnClick = vi.fn()

        // Act
        render(
          <Tab
            isActive={false}
            label="Test"
            value="TEST"
            workflowRunningData={undefined}
            onClick={mockOnClick}
          />,
        )

        // Assert
        expect(screen.getByRole('button')).toBeDisabled()
      })

      it('should apply disabled styles when workflowRunningData is undefined', () => {
        // Arrange
        const mockOnClick = vi.fn()

        // Act
        render(
          <Tab
            isActive={false}
            label="Test"
            value="TEST"
            workflowRunningData={undefined}
            onClick={mockOnClick}
          />,
        )

        // Assert
        const button = screen.getByRole('button')
        expect(button).toHaveClass('!cursor-not-allowed')
        expect(button).toHaveClass('opacity-30')
      })

      it('should not have disabled styles when workflowRunningData is provided', () => {
        // Arrange
        const mockOnClick = vi.fn()
        const workflowData = createWorkflowRunningData()

        // Act
        render(
          <Tab
            isActive={false}
            label="Test"
            value="TEST"
            workflowRunningData={workflowData}
            onClick={mockOnClick}
          />,
        )

        // Assert
        const button = screen.getByRole('button')
        expect(button).not.toHaveClass('!cursor-not-allowed')
        expect(button).not.toHaveClass('opacity-30')
      })
    })
  })

  // -------------------------------------------------------------------------
  // Event Handlers Tests - Verify click behavior
  // -------------------------------------------------------------------------
  describe('Event Handlers', () => {
    it('should call onClick with value when clicked', () => {
      // Arrange
      const mockOnClick = vi.fn()
      const workflowData = createWorkflowRunningData()

      // Act
      render(
        <Tab
          isActive={false}
          label="Test"
          value="RESULT"
          workflowRunningData={workflowData}
          onClick={mockOnClick}
        />,
      )
      fireEvent.click(screen.getByRole('button'))

      // Assert
      expect(mockOnClick).toHaveBeenCalledTimes(1)
      expect(mockOnClick).toHaveBeenCalledWith('RESULT')
    })

    it('should not call onClick when disabled (no workflowRunningData)', () => {
      // Arrange
      const mockOnClick = vi.fn()

      // Act
      render(
        <Tab
          isActive={false}
          label="Test"
          value="TEST"
          workflowRunningData={undefined}
          onClick={mockOnClick}
        />,
      )
      fireEvent.click(screen.getByRole('button'))

      // Assert
      expect(mockOnClick).not.toHaveBeenCalled()
    })

    it('should handle multiple clicks correctly', () => {
      // Arrange
      const mockOnClick = vi.fn()
      const workflowData = createWorkflowRunningData()

      // Act
      render(
        <Tab
          isActive={false}
          label="Test"
          value="TEST"
          workflowRunningData={workflowData}
          onClick={mockOnClick}
        />,
      )
      const button = screen.getByRole('button')
      fireEvent.click(button)
      fireEvent.click(button)
      fireEvent.click(button)

      // Assert
      expect(mockOnClick).toHaveBeenCalledTimes(3)
    })
  })

  // -------------------------------------------------------------------------
  // Memoization Tests - Verify React.memo optimization
  // -------------------------------------------------------------------------
  describe('Memoization', () => {
    it('should not re-render when props are the same', () => {
      // Arrange
      const mockOnClick = vi.fn()
      const workflowData = createWorkflowRunningData()
      const renderSpy = vi.fn()

      const TabWithSpy: React.FC<React.ComponentProps<typeof Tab>> = (props) => {
        renderSpy()
        return <Tab {...props} />
      }
      const MemoizedTabWithSpy = React.memo(TabWithSpy)

      // Act
      const { rerender } = render(
        <MemoizedTabWithSpy
          isActive={false}
          label="Test"
          value="TEST"
          workflowRunningData={workflowData}
          onClick={mockOnClick}
        />,
      )

      // Re-render with same props
      rerender(
        <MemoizedTabWithSpy
          isActive={false}
          label="Test"
          value="TEST"
          workflowRunningData={workflowData}
          onClick={mockOnClick}
        />,
      )

      // Assert - React.memo should prevent re-render with same props
      expect(renderSpy).toHaveBeenCalledTimes(1)
    })

    it('should re-render when isActive prop changes', () => {
      // Arrange
      const mockOnClick = vi.fn()
      const workflowData = createWorkflowRunningData()

      // Act
      const { rerender } = render(
        <Tab
          isActive={false}
          label="Test"
          value="TEST"
          workflowRunningData={workflowData}
          onClick={mockOnClick}
        />,
      )

      // Assert initial state
      expect(screen.getByRole('button')).toHaveClass('text-text-tertiary')

      // Rerender with changed prop
      rerender(
        <Tab
          isActive={true}
          label="Test"
          value="TEST"
          workflowRunningData={workflowData}
          onClick={mockOnClick}
        />,
      )

      // Assert updated state
      expect(screen.getByRole('button')).toHaveClass('text-text-primary')
    })

    it('should re-render when label prop changes', () => {
      // Arrange
      const mockOnClick = vi.fn()
      const workflowData = createWorkflowRunningData()

      // Act
      const { rerender } = render(
        <Tab
          isActive={false}
          label="Original Label"
          value="TEST"
          workflowRunningData={workflowData}
          onClick={mockOnClick}
        />,
      )

      // Assert initial state
      expect(screen.getByText('Original Label')).toBeInTheDocument()

      // Rerender with changed prop
      rerender(
        <Tab
          isActive={false}
          label="Updated Label"
          value="TEST"
          workflowRunningData={workflowData}
          onClick={mockOnClick}
        />,
      )

      // Assert updated state
      expect(screen.getByText('Updated Label')).toBeInTheDocument()
      expect(screen.queryByText('Original Label')).not.toBeInTheDocument()
    })

    it('should use stable handleClick callback with useCallback', () => {
      // Arrange
      const mockOnClick = vi.fn()
      const workflowData = createWorkflowRunningData()

      // Act
      const { rerender } = render(
        <Tab
          isActive={false}
          label="Test"
          value="TEST_VALUE"
          workflowRunningData={workflowData}
          onClick={mockOnClick}
        />,
      )

      fireEvent.click(screen.getByRole('button'))
      expect(mockOnClick).toHaveBeenCalledWith('TEST_VALUE')

      // Rerender with same value and onClick
      rerender(
        <Tab
          isActive={true}
          label="Test"
          value="TEST_VALUE"
          workflowRunningData={workflowData}
          onClick={mockOnClick}
        />,
      )

      fireEvent.click(screen.getByRole('button'))
      expect(mockOnClick).toHaveBeenCalledTimes(2)
      expect(mockOnClick).toHaveBeenLastCalledWith('TEST_VALUE')
    })
  })

  // -------------------------------------------------------------------------
  // Edge Cases Tests - Verify boundary conditions
  // -------------------------------------------------------------------------
  describe('Edge Cases', () => {
    it('should handle special characters in label', () => {
      // Arrange
      const mockOnClick = vi.fn()
      const workflowData = createWorkflowRunningData()
      const specialLabel = 'Tab <>&"\''

      // Act
      render(
        <Tab
          isActive={false}
          label={specialLabel}
          value="TEST"
          workflowRunningData={workflowData}
          onClick={mockOnClick}
        />,
      )

      // Assert
      expect(screen.getByText(specialLabel)).toBeInTheDocument()
    })

    it('should handle special characters in value', () => {
      // Arrange
      const mockOnClick = vi.fn()
      const workflowData = createWorkflowRunningData()

      // Act
      render(
        <Tab
          isActive={false}
          label="Test"
          value="SPECIAL_VALUE_123"
          workflowRunningData={workflowData}
          onClick={mockOnClick}
        />,
      )
      fireEvent.click(screen.getByRole('button'))

      // Assert
      expect(mockOnClick).toHaveBeenCalledWith('SPECIAL_VALUE_123')
    })

    it('should handle unicode in label', () => {
      // Arrange
      const mockOnClick = vi.fn()
      const workflowData = createWorkflowRunningData()

      // Act
      render(
        <Tab
          isActive={false}
          label="结果 🚀"
          value="TEST"
          workflowRunningData={workflowData}
          onClick={mockOnClick}
        />,
      )

      // Assert
      expect(screen.getByText('结果 🚀')).toBeInTheDocument()
    })

    it('should combine isActive and disabled states correctly', () => {
      // Arrange
      const mockOnClick = vi.fn()

      // Act - Active but disabled (no workflowRunningData)
      render(
        <Tab
          isActive={true}
          label="Test"
          value="TEST"
          workflowRunningData={undefined}
          onClick={mockOnClick}
        />,
      )

      // Assert
      const button = screen.getByRole('button')
      expect(button).toBeDisabled()
      expect(button).toHaveClass('border-util-colors-blue-brand-blue-brand-600')
      expect(button).toHaveClass('!cursor-not-allowed')
      expect(button).toHaveClass('opacity-30')
    })
  })
})

// ============================================================================
// Tabs Component Tests
// ============================================================================

describe('Tabs', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // -------------------------------------------------------------------------
  // Rendering Tests - Verify basic component rendering
  // -------------------------------------------------------------------------
  describe('Rendering', () => {
    it('should render all three tabs', () => {
      // Arrange
      const mockSwitchTab = vi.fn()
      const workflowData = createWorkflowRunningData()

      // Act
      render(
        <Tabs
          currentTab="RESULT"
          workflowRunningData={workflowData}
          switchTab={mockSwitchTab}
        />,
      )

      // Assert - Check all three tabs are rendered with i18n keys
      expect(screen.getByRole('button', { name: 'runLog.result' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'runLog.detail' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'runLog.tracing' })).toBeInTheDocument()
    })

    it('should render container with correct styles', () => {
      // Arrange
      const mockSwitchTab = vi.fn()
      const workflowData = createWorkflowRunningData()

      // Act
      const { container } = render(
        <Tabs
          currentTab="RESULT"
          workflowRunningData={workflowData}
          switchTab={mockSwitchTab}
        />,
      )

      // Assert
      const tabsContainer = container.firstChild
      expect(tabsContainer).toHaveClass('flex')
      expect(tabsContainer).toHaveClass('shrink-0')
      expect(tabsContainer).toHaveClass('items-center')
      expect(tabsContainer).toHaveClass('gap-x-6')
      expect(tabsContainer).toHaveClass('border-b-[0.5px]')
      expect(tabsContainer).toHaveClass('border-divider-subtle')
      expect(tabsContainer).toHaveClass('px-4')
    })

    it('should render exactly three tab buttons', () => {
      // Arrange
      const mockSwitchTab = vi.fn()
      const workflowData = createWorkflowRunningData()

      // Act
      render(
        <Tabs
          currentTab="RESULT"
          workflowRunningData={workflowData}
          switchTab={mockSwitchTab}
        />,
      )

      // Assert
      const buttons = screen.getAllByRole('button')
      expect(buttons).toHaveLength(3)
    })
  })

  // -------------------------------------------------------------------------
  // Props Tests - Verify different prop combinations
  // -------------------------------------------------------------------------
  describe('Props', () => {
    describe('currentTab prop', () => {
      it('should set RESULT tab as active when currentTab is RESULT', () => {
        // Arrange
        const mockSwitchTab = vi.fn()
        const workflowData = createWorkflowRunningData()

        // Act
        render(
          <Tabs
            currentTab="RESULT"
            workflowRunningData={workflowData}
            switchTab={mockSwitchTab}
          />,
        )

        // Assert
        const resultTab = screen.getByRole('button', { name: 'runLog.result' })
        const detailTab = screen.getByRole('button', { name: 'runLog.detail' })
        const tracingTab = screen.getByRole('button', { name: 'runLog.tracing' })

        expect(resultTab).toHaveClass('text-text-primary')
        expect(detailTab).toHaveClass('text-text-tertiary')
        expect(tracingTab).toHaveClass('text-text-tertiary')
      })

      it('should set DETAIL tab as active when currentTab is DETAIL', () => {
        // Arrange
        const mockSwitchTab = vi.fn()
        const workflowData = createWorkflowRunningData()

        // Act
        render(
          <Tabs
            currentTab="DETAIL"
            workflowRunningData={workflowData}
            switchTab={mockSwitchTab}
          />,
        )

        // Assert
        const resultTab = screen.getByRole('button', { name: 'runLog.result' })
        const detailTab = screen.getByRole('button', { name: 'runLog.detail' })
        const tracingTab = screen.getByRole('button', { name: 'runLog.tracing' })

        expect(resultTab).toHaveClass('text-text-tertiary')
        expect(detailTab).toHaveClass('text-text-primary')
        expect(tracingTab).toHaveClass('text-text-tertiary')
      })

      it('should set TRACING tab as active when currentTab is TRACING', () => {
        // Arrange
        const mockSwitchTab = vi.fn()
        const workflowData = createWorkflowRunningData()

        // Act
        render(
          <Tabs
            currentTab="TRACING"
            workflowRunningData={workflowData}
            switchTab={mockSwitchTab}
          />,
        )

        // Assert
        const resultTab = screen.getByRole('button', { name: 'runLog.result' })
        const detailTab = screen.getByRole('button', { name: 'runLog.detail' })
        const tracingTab = screen.getByRole('button', { name: 'runLog.tracing' })

        expect(resultTab).toHaveClass('text-text-tertiary')
        expect(detailTab).toHaveClass('text-text-tertiary')
        expect(tracingTab).toHaveClass('text-text-primary')
      })

      it('should handle unknown currentTab gracefully', () => {
        // Arrange
        const mockSwitchTab = vi.fn()
        const workflowData = createWorkflowRunningData()

        // Act
        render(
          <Tabs
            currentTab="UNKNOWN"
            workflowRunningData={workflowData}
            switchTab={mockSwitchTab}
          />,
        )

        // Assert - All tabs should be inactive
        const resultTab = screen.getByRole('button', { name: 'runLog.result' })
        const detailTab = screen.getByRole('button', { name: 'runLog.detail' })
        const tracingTab = screen.getByRole('button', { name: 'runLog.tracing' })

        expect(resultTab).toHaveClass('text-text-tertiary')
        expect(detailTab).toHaveClass('text-text-tertiary')
        expect(tracingTab).toHaveClass('text-text-tertiary')
      })
    })

    describe('workflowRunningData prop', () => {
      it('should enable all tabs when workflowRunningData is provided', () => {
        // Arrange
        const mockSwitchTab = vi.fn()
        const workflowData = createWorkflowRunningData()

        // Act
        render(
          <Tabs
            currentTab="RESULT"
            workflowRunningData={workflowData}
            switchTab={mockSwitchTab}
          />,
        )

        // Assert
        const buttons = screen.getAllByRole('button')
        buttons.forEach((button) => {
          expect(button).not.toBeDisabled()
        })
      })

      it('should disable all tabs when workflowRunningData is undefined', () => {
        // Arrange
        const mockSwitchTab = vi.fn()

        // Act
        render(
          <Tabs
            currentTab="RESULT"
            workflowRunningData={undefined}
            switchTab={mockSwitchTab}
          />,
        )

        // Assert
        const buttons = screen.getAllByRole('button')
        buttons.forEach((button) => {
          expect(button).toBeDisabled()
          expect(button).toHaveClass('opacity-30')
        })
      })

      it('should pass workflowRunningData to all Tab components', () => {
        // Arrange
        const mockSwitchTab = vi.fn()
        const workflowData = createWorkflowRunningData()

        // Act
        render(
          <Tabs
            currentTab="RESULT"
            workflowRunningData={workflowData}
            switchTab={mockSwitchTab}
          />,
        )

        // Assert - All tabs should be enabled (workflowRunningData passed)
        const buttons = screen.getAllByRole('button')
        buttons.forEach((button) => {
          expect(button).not.toHaveClass('opacity-30')
        })
      })
    })

    describe('switchTab prop', () => {
      it('should pass switchTab function to Tab onClick', () => {
        // Arrange
        const mockSwitchTab = vi.fn()
        const workflowData = createWorkflowRunningData()

        // Act
        render(
          <Tabs
            currentTab="RESULT"
            workflowRunningData={workflowData}
            switchTab={mockSwitchTab}
          />,
        )
        fireEvent.click(screen.getByRole('button', { name: 'runLog.detail' }))

        // Assert
        expect(mockSwitchTab).toHaveBeenCalledWith('DETAIL')
      })
    })
  })

  // -------------------------------------------------------------------------
  // Event Handlers Tests - Verify click behavior
  // -------------------------------------------------------------------------
  describe('Event Handlers', () => {
    it('should call switchTab with RESULT when RESULT tab is clicked', () => {
      // Arrange
      const mockSwitchTab = vi.fn()
      const workflowData = createWorkflowRunningData()

      // Act
      render(
        <Tabs
          currentTab="DETAIL"
          workflowRunningData={workflowData}
          switchTab={mockSwitchTab}
        />,
      )
      fireEvent.click(screen.getByRole('button', { name: 'runLog.result' }))

      // Assert
      expect(mockSwitchTab).toHaveBeenCalledWith('RESULT')
    })

    it('should call switchTab with DETAIL when DETAIL tab is clicked', () => {
      // Arrange
      const mockSwitchTab = vi.fn()
      const workflowData = createWorkflowRunningData()

      // Act
      render(
        <Tabs
          currentTab="RESULT"
          workflowRunningData={workflowData}
          switchTab={mockSwitchTab}
        />,
      )
      fireEvent.click(screen.getByRole('button', { name: 'runLog.detail' }))

      // Assert
      expect(mockSwitchTab).toHaveBeenCalledWith('DETAIL')
    })

    it('should call switchTab with TRACING when TRACING tab is clicked', () => {
      // Arrange
      const mockSwitchTab = vi.fn()
      const workflowData = createWorkflowRunningData()

      // Act
      render(
        <Tabs
          currentTab="RESULT"
          workflowRunningData={workflowData}
          switchTab={mockSwitchTab}
        />,
      )
      fireEvent.click(screen.getByRole('button', { name: 'runLog.tracing' }))

      // Assert
      expect(mockSwitchTab).toHaveBeenCalledWith('TRACING')
    })

    it('should not call switchTab when tabs are disabled', () => {
      // Arrange
      const mockSwitchTab = vi.fn()

      // Act
      render(
        <Tabs
          currentTab="RESULT"
          workflowRunningData={undefined}
          switchTab={mockSwitchTab}
        />,
      )

      const buttons = screen.getAllByRole('button')
      buttons.forEach((button) => {
        fireEvent.click(button)
      })

      // Assert
      expect(mockSwitchTab).not.toHaveBeenCalled()
    })

    it('should allow clicking the currently active tab', () => {
      // Arrange
      const mockSwitchTab = vi.fn()
      const workflowData = createWorkflowRunningData()

      // Act
      render(
        <Tabs
          currentTab="RESULT"
          workflowRunningData={workflowData}
          switchTab={mockSwitchTab}
        />,
      )
      fireEvent.click(screen.getByRole('button', { name: 'runLog.result' }))

      // Assert
      expect(mockSwitchTab).toHaveBeenCalledWith('RESULT')
    })
  })

  // -------------------------------------------------------------------------
  // Memoization Tests - Verify React.memo optimization
  // -------------------------------------------------------------------------
  describe('Memoization', () => {
    it('should not re-render when props are the same', () => {
      // Arrange
      const mockSwitchTab = vi.fn()
      const workflowData = createWorkflowRunningData()
      const renderSpy = vi.fn()

      const TabsWithSpy: React.FC<React.ComponentProps<typeof Tabs>> = (props) => {
        renderSpy()
        return <Tabs {...props} />
      }
      const MemoizedTabsWithSpy = React.memo(TabsWithSpy)

      // Act
      const { rerender } = render(
        <MemoizedTabsWithSpy
          currentTab="RESULT"
          workflowRunningData={workflowData}
          switchTab={mockSwitchTab}
        />,
      )

      // Re-render with same props
      rerender(
        <MemoizedTabsWithSpy
          currentTab="RESULT"
          workflowRunningData={workflowData}
          switchTab={mockSwitchTab}
        />,
      )

      // Assert - React.memo should prevent re-render with same props
      expect(renderSpy).toHaveBeenCalledTimes(1)
    })

    it('should re-render when currentTab changes', () => {
      // Arrange
      const mockSwitchTab = vi.fn()
      const workflowData = createWorkflowRunningData()

      // Act
      const { rerender } = render(
        <Tabs
          currentTab="RESULT"
          workflowRunningData={workflowData}
          switchTab={mockSwitchTab}
        />,
      )

      // Assert initial state
      expect(screen.getByRole('button', { name: 'runLog.result' })).toHaveClass('text-text-primary')

      // Rerender with changed prop
      rerender(
        <Tabs
          currentTab="DETAIL"
          workflowRunningData={workflowData}
          switchTab={mockSwitchTab}
        />,
      )

      // Assert updated state
      expect(screen.getByRole('button', { name: 'runLog.result' })).toHaveClass('text-text-tertiary')
      expect(screen.getByRole('button', { name: 'runLog.detail' })).toHaveClass('text-text-primary')
    })

    it('should re-render when workflowRunningData changes from undefined to defined', () => {
      // Arrange
      const mockSwitchTab = vi.fn()
      const workflowData = createWorkflowRunningData()

      // Act
      const { rerender } = render(
        <Tabs
          currentTab="RESULT"
          workflowRunningData={undefined}
          switchTab={mockSwitchTab}
        />,
      )

      // Assert initial disabled state
      const buttons = screen.getAllByRole('button')
      buttons.forEach((button) => {
        expect(button).toBeDisabled()
      })

      // Rerender with workflowRunningData
      rerender(
        <Tabs
          currentTab="RESULT"
          workflowRunningData={workflowData}
          switchTab={mockSwitchTab}
        />,
      )

      // Assert enabled state
      const updatedButtons = screen.getAllByRole('button')
      updatedButtons.forEach((button) => {
        expect(button).not.toBeDisabled()
      })
    })
  })

  // -------------------------------------------------------------------------
  // Edge Cases Tests - Verify boundary conditions
  // -------------------------------------------------------------------------
  describe('Edge Cases', () => {
    it('should handle empty string currentTab', () => {
      // Arrange
      const mockSwitchTab = vi.fn()
      const workflowData = createWorkflowRunningData()

      // Act
      render(
        <Tabs
          currentTab=""
          workflowRunningData={workflowData}
          switchTab={mockSwitchTab}
        />,
      )

      // Assert - All tabs should be inactive
      const buttons = screen.getAllByRole('button')
      buttons.forEach((button) => {
        expect(button).toHaveClass('text-text-tertiary')
      })
    })

    it('should handle case-sensitive tab values', () => {
      // Arrange
      const mockSwitchTab = vi.fn()
      const workflowData = createWorkflowRunningData()

      // Act - lowercase "result" should not match "RESULT"
      render(
        <Tabs
          currentTab="result"
          workflowRunningData={workflowData}
          switchTab={mockSwitchTab}
        />,
      )

      // Assert - Result tab should not be active (case mismatch)
      expect(screen.getByRole('button', { name: 'runLog.result' })).toHaveClass('text-text-tertiary')
    })

    it('should handle whitespace in currentTab', () => {
      // Arrange
      const mockSwitchTab = vi.fn()
      const workflowData = createWorkflowRunningData()

      // Act
      render(
        <Tabs
          currentTab=" RESULT "
          workflowRunningData={workflowData}
          switchTab={mockSwitchTab}
        />,
      )

      // Assert - Should not match due to whitespace
      expect(screen.getByRole('button', { name: 'runLog.result' })).toHaveClass('text-text-tertiary')
    })

    it('should render correctly with minimal workflowRunningData', () => {
      // Arrange
      const mockSwitchTab = vi.fn()
      const minimalWorkflowData: WorkflowRunningData = {
        result: {
          inputs_truncated: false,
          process_data_truncated: false,
          outputs_truncated: false,
          status: 'running',
        },
      }

      // Act
      render(
        <Tabs
          currentTab="RESULT"
          workflowRunningData={minimalWorkflowData}
          switchTab={mockSwitchTab}
        />,
      )

      // Assert
      const buttons = screen.getAllByRole('button')
      buttons.forEach((button) => {
        expect(button).not.toBeDisabled()
      })
    })

    it('should maintain tab order (RESULT, DETAIL, TRACING)', () => {
      // Arrange
      const mockSwitchTab = vi.fn()
      const workflowData = createWorkflowRunningData()

      // Act
      render(
        <Tabs
          currentTab="RESULT"
          workflowRunningData={workflowData}
          switchTab={mockSwitchTab}
        />,
      )

      // Assert
      const buttons = screen.getAllByRole('button')
      expect(buttons[0]).toHaveTextContent('runLog.result')
      expect(buttons[1]).toHaveTextContent('runLog.detail')
      expect(buttons[2]).toHaveTextContent('runLog.tracing')
    })
  })

  // -------------------------------------------------------------------------
  // Integration Tests - Verify Tab and Tabs work together
  // -------------------------------------------------------------------------
  describe('Integration', () => {
    it('should correctly pass all props to child Tab components', () => {
      // Arrange
      const mockSwitchTab = vi.fn()
      const workflowData = createWorkflowRunningData()

      // Act
      render(
        <Tabs
          currentTab="DETAIL"
          workflowRunningData={workflowData}
          switchTab={mockSwitchTab}
        />,
      )

      // Assert - Verify each tab has correct props
      const resultTab = screen.getByRole('button', { name: 'runLog.result' })
      const detailTab = screen.getByRole('button', { name: 'runLog.detail' })
      const tracingTab = screen.getByRole('button', { name: 'runLog.tracing' })

      // Check active states
      expect(resultTab).toHaveClass('text-text-tertiary')
      expect(detailTab).toHaveClass('text-text-primary')
      expect(tracingTab).toHaveClass('text-text-tertiary')

      // Check enabled states
      expect(resultTab).not.toBeDisabled()
      expect(detailTab).not.toBeDisabled()
      expect(tracingTab).not.toBeDisabled()

      // Check click handlers
      fireEvent.click(resultTab)
      expect(mockSwitchTab).toHaveBeenCalledWith('RESULT')

      fireEvent.click(tracingTab)
      expect(mockSwitchTab).toHaveBeenCalledWith('TRACING')
    })

    it('should support full tab switching workflow', () => {
      // Arrange
      const mockSwitchTab = vi.fn()
      const workflowData = createWorkflowRunningData()
      let currentTab = 'RESULT'

      // Act
      const { rerender } = render(
        <Tabs
          currentTab={currentTab}
          workflowRunningData={workflowData}
          switchTab={mockSwitchTab}
        />,
      )

      // Simulate clicking DETAIL tab
      fireEvent.click(screen.getByRole('button', { name: 'runLog.detail' }))
      expect(mockSwitchTab).toHaveBeenCalledWith('DETAIL')

      // Update currentTab and rerender (simulating parent state update)
      currentTab = 'DETAIL'
      rerender(
        <Tabs
          currentTab={currentTab}
          workflowRunningData={workflowData}
          switchTab={mockSwitchTab}
        />,
      )

      // Assert DETAIL is now active
      expect(screen.getByRole('button', { name: 'runLog.detail' })).toHaveClass('text-text-primary')

      // Simulate clicking TRACING tab
      fireEvent.click(screen.getByRole('button', { name: 'runLog.tracing' }))
      expect(mockSwitchTab).toHaveBeenCalledWith('TRACING')

      // Update currentTab and rerender
      currentTab = 'TRACING'
      rerender(
        <Tabs
          currentTab={currentTab}
          workflowRunningData={workflowData}
          switchTab={mockSwitchTab}
        />,
      )

      // Assert TRACING is now active
      expect(screen.getByRole('button', { name: 'runLog.tracing' })).toHaveClass('text-text-primary')
    })

    it('should transition from disabled to enabled state', () => {
      // Arrange
      const mockSwitchTab = vi.fn()
      const workflowData = createWorkflowRunningData()

      // Act - Initial disabled state
      const { rerender } = render(
        <Tabs
          currentTab="RESULT"
          workflowRunningData={undefined}
          switchTab={mockSwitchTab}
        />,
      )

      // Try clicking - should not trigger
      fireEvent.click(screen.getByRole('button', { name: 'runLog.detail' }))
      expect(mockSwitchTab).not.toHaveBeenCalled()

      // Enable tabs
      rerender(
        <Tabs
          currentTab="RESULT"
          workflowRunningData={workflowData}
          switchTab={mockSwitchTab}
        />,
      )

      // Now click should work
      fireEvent.click(screen.getByRole('button', { name: 'runLog.detail' }))
      expect(mockSwitchTab).toHaveBeenCalledWith('DETAIL')
    })
  })
})
