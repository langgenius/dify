import type { WorkflowRunningData } from '@/app/components/workflow/types'
import { fireEvent, render, screen } from '@testing-library/react'
import * as React from 'react'
import Tabs from '../index'
import Tab from '../tab'

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

describe('Tab', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Rendering', () => {
    it('should render tab with label correctly', () => {
      const mockOnClick = vi.fn()
      const workflowData = createWorkflowRunningData()

      render(
        <Tab
          isActive={false}
          label="Test Label"
          value="TEST"
          workflowRunningData={workflowData}
          onClick={mockOnClick}
        />,
      )

      expect(screen.getByRole('button', { name: 'Test Label' })).toBeInTheDocument()
    })

    it('should render as button element with correct type', () => {
      const mockOnClick = vi.fn()
      const workflowData = createWorkflowRunningData()

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
      expect(button).toHaveAttribute('type', 'button')
    })
  })

  describe('Props', () => {
    describe('isActive prop', () => {
      it('should apply active styles when isActive is true', () => {
        const mockOnClick = vi.fn()
        const workflowData = createWorkflowRunningData()

        render(
          <Tab
            isActive={true}
            label="Active Tab"
            value="ACTIVE"
            workflowRunningData={workflowData}
            onClick={mockOnClick}
          />,
        )

        const button = screen.getByRole('button')
        expect(button).toHaveClass('border-util-colors-blue-brand-blue-brand-600')
        expect(button).toHaveClass('text-text-primary')
      })

      it('should apply inactive styles when isActive is false', () => {
        const mockOnClick = vi.fn()
        const workflowData = createWorkflowRunningData()

        render(
          <Tab
            isActive={false}
            label="Inactive Tab"
            value="INACTIVE"
            workflowRunningData={workflowData}
            onClick={mockOnClick}
          />,
        )

        const button = screen.getByRole('button')
        expect(button).toHaveClass('text-text-tertiary')
        expect(button).toHaveClass('border-transparent')
      })
    })

    describe('label prop', () => {
      it('should display the provided label text', () => {
        const mockOnClick = vi.fn()
        const workflowData = createWorkflowRunningData()

        render(
          <Tab
            isActive={false}
            label="Custom Label Text"
            value="TEST"
            workflowRunningData={workflowData}
            onClick={mockOnClick}
          />,
        )

        expect(screen.getByText('Custom Label Text')).toBeInTheDocument()
      })

      it('should handle empty label', () => {
        const mockOnClick = vi.fn()
        const workflowData = createWorkflowRunningData()

        render(
          <Tab
            isActive={false}
            label=""
            value="TEST"
            workflowRunningData={workflowData}
            onClick={mockOnClick}
          />,
        )

        expect(screen.getByRole('button')).toBeInTheDocument()
        expect(screen.getByRole('button')).toHaveTextContent('')
      })

      it('should handle long label text', () => {
        const mockOnClick = vi.fn()
        const workflowData = createWorkflowRunningData()
        const longLabel = 'This is a very long label text for testing purposes'

        render(
          <Tab
            isActive={false}
            label={longLabel}
            value="TEST"
            workflowRunningData={workflowData}
            onClick={mockOnClick}
          />,
        )

        expect(screen.getByText(longLabel)).toBeInTheDocument()
      })
    })

    describe('value prop', () => {
      it('should pass value to onClick handler when clicked', () => {
        const mockOnClick = vi.fn()
        const workflowData = createWorkflowRunningData()
        const testValue = 'CUSTOM_VALUE'

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

        expect(mockOnClick).toHaveBeenCalledWith(testValue)
      })
    })

    describe('workflowRunningData prop', () => {
      it('should enable button when workflowRunningData is provided', () => {
        const mockOnClick = vi.fn()
        const workflowData = createWorkflowRunningData()

        render(
          <Tab
            isActive={false}
            label="Test"
            value="TEST"
            workflowRunningData={workflowData}
            onClick={mockOnClick}
          />,
        )

        expect(screen.getByRole('button')).not.toBeDisabled()
      })

      it('should disable button when workflowRunningData is undefined', () => {
        const mockOnClick = vi.fn()

        render(
          <Tab
            isActive={false}
            label="Test"
            value="TEST"
            workflowRunningData={undefined}
            onClick={mockOnClick}
          />,
        )

        expect(screen.getByRole('button')).toBeDisabled()
      })

      it('should apply disabled styles when workflowRunningData is undefined', () => {
        const mockOnClick = vi.fn()

        render(
          <Tab
            isActive={false}
            label="Test"
            value="TEST"
            workflowRunningData={undefined}
            onClick={mockOnClick}
          />,
        )

        const button = screen.getByRole('button')
        expect(button).toHaveClass('!cursor-not-allowed')
        expect(button).toHaveClass('opacity-30')
      })

      it('should not have disabled styles when workflowRunningData is provided', () => {
        const mockOnClick = vi.fn()
        const workflowData = createWorkflowRunningData()

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
        expect(button).not.toHaveClass('!cursor-not-allowed')
        expect(button).not.toHaveClass('opacity-30')
      })
    })
  })

  describe('Event Handlers', () => {
    it('should call onClick with value when clicked', () => {
      const mockOnClick = vi.fn()
      const workflowData = createWorkflowRunningData()

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

      expect(mockOnClick).toHaveBeenCalledTimes(1)
      expect(mockOnClick).toHaveBeenCalledWith('RESULT')
    })

    it('should not call onClick when disabled (no workflowRunningData)', () => {
      const mockOnClick = vi.fn()

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

      expect(mockOnClick).not.toHaveBeenCalled()
    })

    it('should handle multiple clicks correctly', () => {
      const mockOnClick = vi.fn()
      const workflowData = createWorkflowRunningData()

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

      expect(mockOnClick).toHaveBeenCalledTimes(3)
    })
  })

  describe('Memoization', () => {
    it('should not re-render when props are the same', () => {
      const mockOnClick = vi.fn()
      const workflowData = createWorkflowRunningData()
      const renderSpy = vi.fn()

      const TabWithSpy: React.FC<React.ComponentProps<typeof Tab>> = (props) => {
        renderSpy()
        return <Tab {...props} />
      }
      const MemoizedTabWithSpy = React.memo(TabWithSpy)

      const { rerender } = render(
        <MemoizedTabWithSpy
          isActive={false}
          label="Test"
          value="TEST"
          workflowRunningData={workflowData}
          onClick={mockOnClick}
        />,
      )

      rerender(
        <MemoizedTabWithSpy
          isActive={false}
          label="Test"
          value="TEST"
          workflowRunningData={workflowData}
          onClick={mockOnClick}
        />,
      )

      expect(renderSpy).toHaveBeenCalledTimes(1)
    })

    it('should re-render when isActive prop changes', () => {
      const mockOnClick = vi.fn()
      const workflowData = createWorkflowRunningData()

      const { rerender } = render(
        <Tab
          isActive={false}
          label="Test"
          value="TEST"
          workflowRunningData={workflowData}
          onClick={mockOnClick}
        />,
      )

      expect(screen.getByRole('button')).toHaveClass('text-text-tertiary')

      rerender(
        <Tab
          isActive={true}
          label="Test"
          value="TEST"
          workflowRunningData={workflowData}
          onClick={mockOnClick}
        />,
      )

      expect(screen.getByRole('button')).toHaveClass('text-text-primary')
    })

    it('should re-render when label prop changes', () => {
      const mockOnClick = vi.fn()
      const workflowData = createWorkflowRunningData()

      const { rerender } = render(
        <Tab
          isActive={false}
          label="Original Label"
          value="TEST"
          workflowRunningData={workflowData}
          onClick={mockOnClick}
        />,
      )

      expect(screen.getByText('Original Label')).toBeInTheDocument()

      rerender(
        <Tab
          isActive={false}
          label="Updated Label"
          value="TEST"
          workflowRunningData={workflowData}
          onClick={mockOnClick}
        />,
      )

      expect(screen.getByText('Updated Label')).toBeInTheDocument()
      expect(screen.queryByText('Original Label')).not.toBeInTheDocument()
    })

    it('should use stable handleClick callback with useCallback', () => {
      const mockOnClick = vi.fn()
      const workflowData = createWorkflowRunningData()

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

  describe('Edge Cases', () => {
    it('should handle special characters in label', () => {
      const mockOnClick = vi.fn()
      const workflowData = createWorkflowRunningData()
      const specialLabel = 'Tab <>&"\''

      render(
        <Tab
          isActive={false}
          label={specialLabel}
          value="TEST"
          workflowRunningData={workflowData}
          onClick={mockOnClick}
        />,
      )

      expect(screen.getByText(specialLabel)).toBeInTheDocument()
    })

    it('should handle special characters in value', () => {
      const mockOnClick = vi.fn()
      const workflowData = createWorkflowRunningData()

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

      expect(mockOnClick).toHaveBeenCalledWith('SPECIAL_VALUE_123')
    })

    it('should handle unicode in label', () => {
      const mockOnClick = vi.fn()
      const workflowData = createWorkflowRunningData()

      render(
        <Tab
          isActive={false}
          label="结果 🚀"
          value="TEST"
          workflowRunningData={workflowData}
          onClick={mockOnClick}
        />,
      )

      expect(screen.getByText('结果 🚀')).toBeInTheDocument()
    })

    it('should combine isActive and disabled states correctly', () => {
      const mockOnClick = vi.fn()

      render(
        <Tab
          isActive={true}
          label="Test"
          value="TEST"
          workflowRunningData={undefined}
          onClick={mockOnClick}
        />,
      )

      const button = screen.getByRole('button')
      expect(button).toBeDisabled()
      expect(button).toHaveClass('border-util-colors-blue-brand-blue-brand-600')
      expect(button).toHaveClass('!cursor-not-allowed')
      expect(button).toHaveClass('opacity-30')
    })
  })
})

describe('Tabs', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Rendering', () => {
    it('should render all three tabs', () => {
      const mockSwitchTab = vi.fn()
      const workflowData = createWorkflowRunningData()

      render(
        <Tabs
          currentTab="RESULT"
          workflowRunningData={workflowData}
          switchTab={mockSwitchTab}
        />,
      )

      expect(screen.getByRole('button', { name: 'runLog.result' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'runLog.detail' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'runLog.tracing' })).toBeInTheDocument()
    })

    it('should render container with correct styles', () => {
      const mockSwitchTab = vi.fn()
      const workflowData = createWorkflowRunningData()

      const { container } = render(
        <Tabs
          currentTab="RESULT"
          workflowRunningData={workflowData}
          switchTab={mockSwitchTab}
        />,
      )

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
      const mockSwitchTab = vi.fn()
      const workflowData = createWorkflowRunningData()

      render(
        <Tabs
          currentTab="RESULT"
          workflowRunningData={workflowData}
          switchTab={mockSwitchTab}
        />,
      )

      const buttons = screen.getAllByRole('button')
      expect(buttons).toHaveLength(3)
    })
  })

  describe('Props', () => {
    describe('currentTab prop', () => {
      it('should set RESULT tab as active when currentTab is RESULT', () => {
        const mockSwitchTab = vi.fn()
        const workflowData = createWorkflowRunningData()

        render(
          <Tabs
            currentTab="RESULT"
            workflowRunningData={workflowData}
            switchTab={mockSwitchTab}
          />,
        )

        const resultTab = screen.getByRole('button', { name: 'runLog.result' })
        const detailTab = screen.getByRole('button', { name: 'runLog.detail' })
        const tracingTab = screen.getByRole('button', { name: 'runLog.tracing' })

        expect(resultTab).toHaveClass('text-text-primary')
        expect(detailTab).toHaveClass('text-text-tertiary')
        expect(tracingTab).toHaveClass('text-text-tertiary')
      })

      it('should set DETAIL tab as active when currentTab is DETAIL', () => {
        const mockSwitchTab = vi.fn()
        const workflowData = createWorkflowRunningData()

        render(
          <Tabs
            currentTab="DETAIL"
            workflowRunningData={workflowData}
            switchTab={mockSwitchTab}
          />,
        )

        const resultTab = screen.getByRole('button', { name: 'runLog.result' })
        const detailTab = screen.getByRole('button', { name: 'runLog.detail' })
        const tracingTab = screen.getByRole('button', { name: 'runLog.tracing' })

        expect(resultTab).toHaveClass('text-text-tertiary')
        expect(detailTab).toHaveClass('text-text-primary')
        expect(tracingTab).toHaveClass('text-text-tertiary')
      })

      it('should set TRACING tab as active when currentTab is TRACING', () => {
        const mockSwitchTab = vi.fn()
        const workflowData = createWorkflowRunningData()

        render(
          <Tabs
            currentTab="TRACING"
            workflowRunningData={workflowData}
            switchTab={mockSwitchTab}
          />,
        )

        const resultTab = screen.getByRole('button', { name: 'runLog.result' })
        const detailTab = screen.getByRole('button', { name: 'runLog.detail' })
        const tracingTab = screen.getByRole('button', { name: 'runLog.tracing' })

        expect(resultTab).toHaveClass('text-text-tertiary')
        expect(detailTab).toHaveClass('text-text-tertiary')
        expect(tracingTab).toHaveClass('text-text-primary')
      })

      it('should handle unknown currentTab gracefully', () => {
        const mockSwitchTab = vi.fn()
        const workflowData = createWorkflowRunningData()

        render(
          <Tabs
            currentTab="UNKNOWN"
            workflowRunningData={workflowData}
            switchTab={mockSwitchTab}
          />,
        )

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
        const mockSwitchTab = vi.fn()
        const workflowData = createWorkflowRunningData()

        render(
          <Tabs
            currentTab="RESULT"
            workflowRunningData={workflowData}
            switchTab={mockSwitchTab}
          />,
        )

        const buttons = screen.getAllByRole('button')
        buttons.forEach((button) => {
          expect(button).not.toBeDisabled()
        })
      })

      it('should disable all tabs when workflowRunningData is undefined', () => {
        const mockSwitchTab = vi.fn()

        render(
          <Tabs
            currentTab="RESULT"
            workflowRunningData={undefined}
            switchTab={mockSwitchTab}
          />,
        )

        const buttons = screen.getAllByRole('button')
        buttons.forEach((button) => {
          expect(button).toBeDisabled()
          expect(button).toHaveClass('opacity-30')
        })
      })

      it('should pass workflowRunningData to all Tab components', () => {
        const mockSwitchTab = vi.fn()
        const workflowData = createWorkflowRunningData()

        render(
          <Tabs
            currentTab="RESULT"
            workflowRunningData={workflowData}
            switchTab={mockSwitchTab}
          />,
        )

        const buttons = screen.getAllByRole('button')
        buttons.forEach((button) => {
          expect(button).not.toHaveClass('opacity-30')
        })
      })
    })

    describe('switchTab prop', () => {
      it('should pass switchTab function to Tab onClick', () => {
        const mockSwitchTab = vi.fn()
        const workflowData = createWorkflowRunningData()

        render(
          <Tabs
            currentTab="RESULT"
            workflowRunningData={workflowData}
            switchTab={mockSwitchTab}
          />,
        )
        fireEvent.click(screen.getByRole('button', { name: 'runLog.detail' }))

        expect(mockSwitchTab).toHaveBeenCalledWith('DETAIL')
      })
    })
  })

  describe('Event Handlers', () => {
    it('should call switchTab with RESULT when RESULT tab is clicked', () => {
      const mockSwitchTab = vi.fn()
      const workflowData = createWorkflowRunningData()

      render(
        <Tabs
          currentTab="DETAIL"
          workflowRunningData={workflowData}
          switchTab={mockSwitchTab}
        />,
      )
      fireEvent.click(screen.getByRole('button', { name: 'runLog.result' }))

      expect(mockSwitchTab).toHaveBeenCalledWith('RESULT')
    })

    it('should call switchTab with DETAIL when DETAIL tab is clicked', () => {
      const mockSwitchTab = vi.fn()
      const workflowData = createWorkflowRunningData()

      render(
        <Tabs
          currentTab="RESULT"
          workflowRunningData={workflowData}
          switchTab={mockSwitchTab}
        />,
      )
      fireEvent.click(screen.getByRole('button', { name: 'runLog.detail' }))

      expect(mockSwitchTab).toHaveBeenCalledWith('DETAIL')
    })

    it('should call switchTab with TRACING when TRACING tab is clicked', () => {
      const mockSwitchTab = vi.fn()
      const workflowData = createWorkflowRunningData()

      render(
        <Tabs
          currentTab="RESULT"
          workflowRunningData={workflowData}
          switchTab={mockSwitchTab}
        />,
      )
      fireEvent.click(screen.getByRole('button', { name: 'runLog.tracing' }))

      expect(mockSwitchTab).toHaveBeenCalledWith('TRACING')
    })

    it('should not call switchTab when tabs are disabled', () => {
      const mockSwitchTab = vi.fn()

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

      expect(mockSwitchTab).not.toHaveBeenCalled()
    })

    it('should allow clicking the currently active tab', () => {
      const mockSwitchTab = vi.fn()
      const workflowData = createWorkflowRunningData()

      render(
        <Tabs
          currentTab="RESULT"
          workflowRunningData={workflowData}
          switchTab={mockSwitchTab}
        />,
      )
      fireEvent.click(screen.getByRole('button', { name: 'runLog.result' }))

      expect(mockSwitchTab).toHaveBeenCalledWith('RESULT')
    })
  })

  describe('Memoization', () => {
    it('should not re-render when props are the same', () => {
      const mockSwitchTab = vi.fn()
      const workflowData = createWorkflowRunningData()
      const renderSpy = vi.fn()

      const TabsWithSpy: React.FC<React.ComponentProps<typeof Tabs>> = (props) => {
        renderSpy()
        return <Tabs {...props} />
      }
      const MemoizedTabsWithSpy = React.memo(TabsWithSpy)

      const { rerender } = render(
        <MemoizedTabsWithSpy
          currentTab="RESULT"
          workflowRunningData={workflowData}
          switchTab={mockSwitchTab}
        />,
      )

      rerender(
        <MemoizedTabsWithSpy
          currentTab="RESULT"
          workflowRunningData={workflowData}
          switchTab={mockSwitchTab}
        />,
      )

      expect(renderSpy).toHaveBeenCalledTimes(1)
    })

    it('should re-render when currentTab changes', () => {
      const mockSwitchTab = vi.fn()
      const workflowData = createWorkflowRunningData()

      const { rerender } = render(
        <Tabs
          currentTab="RESULT"
          workflowRunningData={workflowData}
          switchTab={mockSwitchTab}
        />,
      )

      expect(screen.getByRole('button', { name: 'runLog.result' })).toHaveClass('text-text-primary')

      rerender(
        <Tabs
          currentTab="DETAIL"
          workflowRunningData={workflowData}
          switchTab={mockSwitchTab}
        />,
      )

      expect(screen.getByRole('button', { name: 'runLog.result' })).toHaveClass('text-text-tertiary')
      expect(screen.getByRole('button', { name: 'runLog.detail' })).toHaveClass('text-text-primary')
    })

    it('should re-render when workflowRunningData changes from undefined to defined', () => {
      const mockSwitchTab = vi.fn()
      const workflowData = createWorkflowRunningData()

      const { rerender } = render(
        <Tabs
          currentTab="RESULT"
          workflowRunningData={undefined}
          switchTab={mockSwitchTab}
        />,
      )

      const buttons = screen.getAllByRole('button')
      buttons.forEach((button) => {
        expect(button).toBeDisabled()
      })

      rerender(
        <Tabs
          currentTab="RESULT"
          workflowRunningData={workflowData}
          switchTab={mockSwitchTab}
        />,
      )

      const updatedButtons = screen.getAllByRole('button')
      updatedButtons.forEach((button) => {
        expect(button).not.toBeDisabled()
      })
    })
  })

  describe('Edge Cases', () => {
    it('should handle empty string currentTab', () => {
      const mockSwitchTab = vi.fn()
      const workflowData = createWorkflowRunningData()

      render(
        <Tabs
          currentTab=""
          workflowRunningData={workflowData}
          switchTab={mockSwitchTab}
        />,
      )

      const buttons = screen.getAllByRole('button')
      buttons.forEach((button) => {
        expect(button).toHaveClass('text-text-tertiary')
      })
    })

    it('should handle case-sensitive tab values', () => {
      const mockSwitchTab = vi.fn()
      const workflowData = createWorkflowRunningData()

      render(
        <Tabs
          currentTab="result"
          workflowRunningData={workflowData}
          switchTab={mockSwitchTab}
        />,
      )

      expect(screen.getByRole('button', { name: 'runLog.result' })).toHaveClass('text-text-tertiary')
    })

    it('should handle whitespace in currentTab', () => {
      const mockSwitchTab = vi.fn()
      const workflowData = createWorkflowRunningData()

      render(
        <Tabs
          currentTab=" RESULT "
          workflowRunningData={workflowData}
          switchTab={mockSwitchTab}
        />,
      )

      expect(screen.getByRole('button', { name: 'runLog.result' })).toHaveClass('text-text-tertiary')
    })

    it('should render correctly with minimal workflowRunningData', () => {
      const mockSwitchTab = vi.fn()
      const minimalWorkflowData: WorkflowRunningData = {
        result: {
          inputs_truncated: false,
          process_data_truncated: false,
          outputs_truncated: false,
          status: 'running',
        },
      }

      render(
        <Tabs
          currentTab="RESULT"
          workflowRunningData={minimalWorkflowData}
          switchTab={mockSwitchTab}
        />,
      )

      const buttons = screen.getAllByRole('button')
      buttons.forEach((button) => {
        expect(button).not.toBeDisabled()
      })
    })

    it('should maintain tab order (RESULT, DETAIL, TRACING)', () => {
      const mockSwitchTab = vi.fn()
      const workflowData = createWorkflowRunningData()

      render(
        <Tabs
          currentTab="RESULT"
          workflowRunningData={workflowData}
          switchTab={mockSwitchTab}
        />,
      )

      const buttons = screen.getAllByRole('button')
      expect(buttons[0]).toHaveTextContent('runLog.result')
      expect(buttons[1]).toHaveTextContent('runLog.detail')
      expect(buttons[2]).toHaveTextContent('runLog.tracing')
    })
  })

  describe('Integration', () => {
    it('should correctly pass all props to child Tab components', () => {
      const mockSwitchTab = vi.fn()
      const workflowData = createWorkflowRunningData()

      render(
        <Tabs
          currentTab="DETAIL"
          workflowRunningData={workflowData}
          switchTab={mockSwitchTab}
        />,
      )

      const resultTab = screen.getByRole('button', { name: 'runLog.result' })
      const detailTab = screen.getByRole('button', { name: 'runLog.detail' })
      const tracingTab = screen.getByRole('button', { name: 'runLog.tracing' })

      expect(resultTab).toHaveClass('text-text-tertiary')
      expect(detailTab).toHaveClass('text-text-primary')
      expect(tracingTab).toHaveClass('text-text-tertiary')

      expect(resultTab).not.toBeDisabled()
      expect(detailTab).not.toBeDisabled()
      expect(tracingTab).not.toBeDisabled()

      fireEvent.click(resultTab)
      expect(mockSwitchTab).toHaveBeenCalledWith('RESULT')

      fireEvent.click(tracingTab)
      expect(mockSwitchTab).toHaveBeenCalledWith('TRACING')
    })

    it('should support full tab switching workflow', () => {
      const mockSwitchTab = vi.fn()
      const workflowData = createWorkflowRunningData()
      let currentTab = 'RESULT'

      const { rerender } = render(
        <Tabs
          currentTab={currentTab}
          workflowRunningData={workflowData}
          switchTab={mockSwitchTab}
        />,
      )

      fireEvent.click(screen.getByRole('button', { name: 'runLog.detail' }))
      expect(mockSwitchTab).toHaveBeenCalledWith('DETAIL')

      currentTab = 'DETAIL'
      rerender(
        <Tabs
          currentTab={currentTab}
          workflowRunningData={workflowData}
          switchTab={mockSwitchTab}
        />,
      )

      expect(screen.getByRole('button', { name: 'runLog.detail' })).toHaveClass('text-text-primary')

      fireEvent.click(screen.getByRole('button', { name: 'runLog.tracing' }))
      expect(mockSwitchTab).toHaveBeenCalledWith('TRACING')

      currentTab = 'TRACING'
      rerender(
        <Tabs
          currentTab={currentTab}
          workflowRunningData={workflowData}
          switchTab={mockSwitchTab}
        />,
      )

      expect(screen.getByRole('button', { name: 'runLog.tracing' })).toHaveClass('text-text-primary')
    })

    it('should transition from disabled to enabled state', () => {
      const mockSwitchTab = vi.fn()
      const workflowData = createWorkflowRunningData()

      const { rerender } = render(
        <Tabs
          currentTab="RESULT"
          workflowRunningData={undefined}
          switchTab={mockSwitchTab}
        />,
      )

      fireEvent.click(screen.getByRole('button', { name: 'runLog.detail' }))
      expect(mockSwitchTab).not.toHaveBeenCalled()

      rerender(
        <Tabs
          currentTab="RESULT"
          workflowRunningData={workflowData}
          switchTab={mockSwitchTab}
        />,
      )

      fireEvent.click(screen.getByRole('button', { name: 'runLog.detail' }))
      expect(mockSwitchTab).toHaveBeenCalledWith('DETAIL')
    })
  })
})
