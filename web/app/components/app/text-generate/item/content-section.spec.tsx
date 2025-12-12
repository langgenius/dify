import React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import type { TFunction } from 'i18next'
import ContentSection from './content-section'
import type { WorkflowProcess } from '@/app/components/base/chat/types'
import type { SiteInfo } from '@/models/share'

// ============================================================================
// Mock Setup
// ============================================================================

jest.mock('@/app/components/base/chat/chat/answer/workflow-process', () => ({
  __esModule: true,
  default: ({ data }: { data: WorkflowProcess }) => (
    <div data-testid="workflow-process">{data.resultText}</div>
  ),
}))

jest.mock('@/app/components/base/markdown', () => ({
  Markdown: ({ content }: { content: string }) => (
    <div data-testid="markdown">{content}</div>
  ),
}))

jest.mock('./result-tab', () => ({
  __esModule: true,
  default: ({ currentTab }: { currentTab: string }) => (
    <div data-testid="result-tab">{currentTab}</div>
  ),
}))

// ============================================================================
// Test Utilities
// ============================================================================

const mockT = ((key: string) => key) as TFunction

/**
 * Creates base props with sensible defaults for ContentSection testing.
 */
const createBaseProps = (overrides?: Partial<Parameters<typeof ContentSection>[0]>) => ({
  depth: 1,
  isError: false,
  content: 'test content',
  currentTab: 'DETAIL' as const,
  onSwitchTab: jest.fn(),
  showResultTabs: false,
  t: mockT,
  siteInfo: null,
  ...overrides,
})

const createWorkflowData = (overrides?: Partial<WorkflowProcess>): WorkflowProcess => ({
  status: 'succeeded',
  tracing: [],
  expand: true,
  resultText: 'workflow result',
  ...overrides,
} as WorkflowProcess)

const createSiteInfo = (overrides?: Partial<SiteInfo>): SiteInfo => ({
  title: 'Test Site',
  icon: '',
  icon_background: '',
  description: '',
  default_language: 'en',
  prompt_public: false,
  copyright: '',
  privacy_policy: '',
  custom_disclaimer: '',
  show_workflow_steps: true,
  use_icon_as_answer_icon: false,
  ...overrides,
})

// ============================================================================
// Test Suite
// ============================================================================

describe('ContentSection', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  // --------------------------------------------------------------------------
  // Basic Rendering Tests
  // Tests for basic component rendering scenarios
  // --------------------------------------------------------------------------
  describe('Basic Rendering', () => {
    it('should render markdown content when no workflow data', () => {
      render(<ContentSection {...createBaseProps({ content: 'Hello World' })} />)
      expect(screen.getByTestId('markdown')).toHaveTextContent('Hello World')
    })

    it('should not render markdown when content is not a string', () => {
      render(<ContentSection {...createBaseProps({ content: { data: 'object' } })} />)
      expect(screen.queryByTestId('markdown')).not.toBeInTheDocument()
    })

    it('should apply rounded styling when not in side panel', () => {
      const { container } = render(<ContentSection {...createBaseProps()} />)
      expect(container.firstChild).toHaveClass('rounded-2xl')
    })

    it('should not apply rounded styling when in side panel', () => {
      const { container } = render(<ContentSection {...createBaseProps({ inSidePanel: true })} />)
      expect(container.firstChild).not.toHaveClass('rounded-2xl')
    })
  })

  // --------------------------------------------------------------------------
  // Task ID Display Tests
  // Tests for task ID rendering in different contexts
  // --------------------------------------------------------------------------
  describe('Task ID Display', () => {
    it('should show task ID without depth suffix at depth 1', () => {
      render(
        <ContentSection
          {...createBaseProps({
            taskId: 'task-123',
            depth: 1,
          })}
        />,
      )
      expect(screen.getByText('task-123')).toBeInTheDocument()
    })

    it('should show task ID with depth suffix at depth > 1', () => {
      render(
        <ContentSection
          {...createBaseProps({
            taskId: 'task-123',
            depth: 3,
          })}
        />,
      )
      expect(screen.getByText('task-123-2')).toBeInTheDocument()
    })

    it('should show execution label with task ID', () => {
      render(
        <ContentSection
          {...createBaseProps({
            taskId: 'task-abc',
          })}
        />,
      )
      expect(screen.getByText('share.generation.execution')).toBeInTheDocument()
    })
  })

  // --------------------------------------------------------------------------
  // Error State Tests
  // Tests for error state display
  // --------------------------------------------------------------------------
  describe('Error State', () => {
    it('should show error message when isError is true', () => {
      render(<ContentSection {...createBaseProps({ isError: true })} />)
      expect(screen.getByText('share.generation.batchFailed.outputPlaceholder')).toBeInTheDocument()
    })

    it('should not show markdown content when isError is true', () => {
      render(<ContentSection {...createBaseProps({ isError: true, content: 'should not show' })} />)
      expect(screen.queryByTestId('markdown')).not.toBeInTheDocument()
    })

    it('should apply error styling to task ID when isError is true', () => {
      render(
        <ContentSection
          {...createBaseProps({
            taskId: 'error-task',
            isError: true,
          })}
        />,
      )
      const executionText = screen.getByText('share.generation.execution').parentElement
      expect(executionText).toHaveClass('text-text-destructive')
    })
  })

  // --------------------------------------------------------------------------
  // Workflow Process Tests
  // Tests for workflow-specific rendering
  // --------------------------------------------------------------------------
  describe('Workflow Process', () => {
    it('should render WorkflowProcessItem when workflowProcessData and siteInfo are present', () => {
      render(
        <ContentSection
          {...createBaseProps({
            workflowProcessData: createWorkflowData(),
            siteInfo: createSiteInfo(),
          })}
        />,
      )
      expect(screen.getByTestId('workflow-process')).toBeInTheDocument()
    })

    it('should not render WorkflowProcessItem when siteInfo is null', () => {
      render(
        <ContentSection
          {...createBaseProps({
            workflowProcessData: createWorkflowData(),
            siteInfo: null,
          })}
        />,
      )
      expect(screen.queryByTestId('workflow-process')).not.toBeInTheDocument()
    })

    it('should show task ID within workflow section', () => {
      render(
        <ContentSection
          {...createBaseProps({
            workflowProcessData: createWorkflowData(),
            taskId: 'wf-task-123',
            siteInfo: createSiteInfo(),
          })}
        />,
      )
      expect(screen.getByText('wf-task-123')).toBeInTheDocument()
    })

    it('should not render ResultTab when isError is true', () => {
      render(
        <ContentSection
          {...createBaseProps({
            workflowProcessData: createWorkflowData(),
            siteInfo: createSiteInfo(),
            isError: true,
          })}
        />,
      )
      expect(screen.queryByTestId('result-tab')).not.toBeInTheDocument()
    })

    it('should render ResultTab when not error', () => {
      render(
        <ContentSection
          {...createBaseProps({
            workflowProcessData: createWorkflowData(),
            siteInfo: createSiteInfo(),
            isError: false,
          })}
        />,
      )
      expect(screen.getByTestId('result-tab')).toBeInTheDocument()
    })
  })

  // --------------------------------------------------------------------------
  // Result Tabs Tests
  // Tests for the result/detail tab switching
  // --------------------------------------------------------------------------
  describe('Result Tabs', () => {
    it('should show tabs when showResultTabs is true', () => {
      render(
        <ContentSection
          {...createBaseProps({
            workflowProcessData: createWorkflowData(),
            siteInfo: createSiteInfo(),
            showResultTabs: true,
          })}
        />,
      )
      expect(screen.getByText('runLog.result')).toBeInTheDocument()
      expect(screen.getByText('runLog.detail')).toBeInTheDocument()
    })

    it('should not show tabs when showResultTabs is false', () => {
      render(
        <ContentSection
          {...createBaseProps({
            workflowProcessData: createWorkflowData(),
            siteInfo: createSiteInfo(),
            showResultTabs: false,
          })}
        />,
      )
      expect(screen.queryByText('runLog.result')).not.toBeInTheDocument()
      expect(screen.queryByText('runLog.detail')).not.toBeInTheDocument()
    })

    it('should call onSwitchTab when RESULT tab is clicked', () => {
      const onSwitchTab = jest.fn()
      render(
        <ContentSection
          {...createBaseProps({
            workflowProcessData: createWorkflowData(),
            siteInfo: createSiteInfo(),
            showResultTabs: true,
            onSwitchTab,
          })}
        />,
      )

      fireEvent.click(screen.getByText('runLog.result'))
      expect(onSwitchTab).toHaveBeenCalledWith('RESULT')
    })

    it('should call onSwitchTab when DETAIL tab is clicked', () => {
      const onSwitchTab = jest.fn()
      render(
        <ContentSection
          {...createBaseProps({
            workflowProcessData: createWorkflowData(),
            siteInfo: createSiteInfo(),
            showResultTabs: true,
            onSwitchTab,
          })}
        />,
      )

      fireEvent.click(screen.getByText('runLog.detail'))
      expect(onSwitchTab).toHaveBeenCalledWith('DETAIL')
    })

    it('should highlight active tab', () => {
      render(
        <ContentSection
          {...createBaseProps({
            workflowProcessData: createWorkflowData(),
            siteInfo: createSiteInfo(),
            showResultTabs: true,
            currentTab: 'RESULT',
          })}
        />,
      )

      const resultTab = screen.getByText('runLog.result')
      expect(resultTab).toHaveClass('text-text-primary')
    })
  })

  // --------------------------------------------------------------------------
  // Boundary Conditions Tests
  // Tests for edge cases and boundary values
  // --------------------------------------------------------------------------
  describe('Boundary Conditions', () => {
    it('should handle empty string content', () => {
      render(<ContentSection {...createBaseProps({ content: '' })} />)
      expect(screen.getByTestId('markdown')).toHaveTextContent('')
    })

    it('should handle null siteInfo', () => {
      render(
        <ContentSection
          {...createBaseProps({
            workflowProcessData: createWorkflowData(),
            siteInfo: null,
          })}
        />,
      )
      // Should not crash and WorkflowProcessItem should not render
      expect(screen.queryByTestId('workflow-process')).not.toBeInTheDocument()
    })

    it('should handle undefined workflowProcessData', () => {
      render(<ContentSection {...createBaseProps({ workflowProcessData: undefined })} />)
      expect(screen.queryByTestId('workflow-process')).not.toBeInTheDocument()
    })

    it('should handle show_workflow_steps false in siteInfo', () => {
      render(
        <ContentSection
          {...createBaseProps({
            workflowProcessData: createWorkflowData(),
            siteInfo: createSiteInfo({ show_workflow_steps: false }),
          })}
        />,
      )
      expect(screen.getByTestId('workflow-process')).toBeInTheDocument()
    })

    it('should handle hideProcessDetail prop', () => {
      render(
        <ContentSection
          {...createBaseProps({
            workflowProcessData: createWorkflowData(),
            siteInfo: createSiteInfo(),
            hideProcessDetail: true,
          })}
        />,
      )
      // Component should still render
      expect(screen.getByTestId('workflow-process')).toBeInTheDocument()
    })
  })
})
