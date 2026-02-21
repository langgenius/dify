import type { ToolInfoInThought } from '../type'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ToolDetail from './tool-detail'

describe('ToolDetail', () => {
  const mockPayload: ToolInfoInThought = {
    name: 'test_tool',
    label: 'Test Tool Label',
    input: 'test input content',
    output: 'test output content',
    isFinished: true,
  }

  const datasetPayload: ToolInfoInThought = {
    ...mockPayload,
    name: 'dataset_123',
    label: 'Dataset Label',
  }

  it('should render the tool label and "used" state when finished', () => {
    render(<ToolDetail payload={mockPayload} />)

    expect(screen.getByText('Test Tool Label')).toBeInTheDocument()
    expect(screen.getByText('tools.thought.used')).toBeInTheDocument()
  })

  it('should render the knowledge label and "using" state when not finished and name is a dataset', () => {
    render(<ToolDetail payload={{ ...datasetPayload, isFinished: false }} />)

    expect(screen.getByText('dataset.knowledge')).toBeInTheDocument()
    expect(screen.getByText('tools.thought.using')).toBeInTheDocument()
  })

  it('should toggle expansion and show request/response details on click', async () => {
    const user = userEvent.setup()
    render(<ToolDetail payload={mockPayload} />)

    // Initially collapsed: request/response titles should not be visible
    expect(screen.queryByText('tools.thought.requestTitle')).not.toBeInTheDocument()
    expect(screen.queryByText(mockPayload.input)).not.toBeInTheDocument()

    // Click to expand
    const label = screen.getByText('Test Tool Label')
    await user.click(label)

    // Now expanded
    expect(screen.getByText('tools.thought.requestTitle')).toBeInTheDocument()
    expect(screen.getByText(mockPayload.input)).toBeInTheDocument()
    expect(screen.getByText('tools.thought.responseTitle')).toBeInTheDocument()
    expect(screen.getByText(mockPayload.output)).toBeInTheDocument()

    // Click again to collapse
    await user.click(label)
    expect(screen.queryByText('tools.thought.requestTitle')).not.toBeInTheDocument()
  })

  it('should apply different styles when expanded', async () => {
    const user = userEvent.setup()
    const { container } = render(<ToolDetail payload={mockPayload} />)
    const rootDiv = container.firstChild as HTMLElement
    const label = screen.getByText('Test Tool Label')
    const headerDiv = label.parentElement!

    // Initial styles
    expect(rootDiv).toHaveClass('bg-workflow-process-bg')
    expect(headerDiv).not.toHaveClass('pb-1.5')

    // Expand
    await user.click(label)
    expect(rootDiv).toHaveClass('bg-background-section-burn')
    expect(headerDiv).toHaveClass('pb-1.5')
  })
})
