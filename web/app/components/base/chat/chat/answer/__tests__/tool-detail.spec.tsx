import type { ToolInfoInThought } from '../../type'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ToolDetail from '../tool-detail'

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
    expect(
      screen.getByRole('button', { name: 'tools.thought.used Test Tool Label' }),
    ).toHaveAttribute('aria-expanded', 'false')
  })

  it('should render the knowledge label and "using" state when not finished and name is a dataset', () => {
    render(<ToolDetail payload={{ ...datasetPayload, isFinished: false }} />)

    expect(screen.getByText('dataset.knowledge')).toBeInTheDocument()
    expect(screen.getByText('tools.thought.using')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'tools.thought.using dataset.knowledge' }),
    ).toHaveAttribute('aria-expanded', 'false')
  })

  it('should toggle expansion and show request/response details on click', async () => {
    const user = userEvent.setup()
    render(<ToolDetail payload={mockPayload} />)

    expect(screen.queryByText('tools.thought.requestTitle')).not.toBeInTheDocument()
    expect(screen.queryByText(mockPayload.input)).not.toBeInTheDocument()

    const toggle = screen.getByRole('button', {
      name: 'tools.thought.used Test Tool Label',
    })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await user.click(toggle)

    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('tools.thought.requestTitle')).toBeInTheDocument()
    expect(screen.getByText(mockPayload.input)).toBeInTheDocument()
    expect(screen.getByText('tools.thought.responseTitle')).toBeInTheDocument()
    expect(screen.getByText(mockPayload.output)).toBeInTheDocument()

    await user.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText('tools.thought.requestTitle')).not.toBeInTheDocument()
  })

  it('should toggle details with Space and Enter', async () => {
    const user = userEvent.setup()
    render(<ToolDetail payload={mockPayload} />)

    const toggle = screen.getByRole('button', {
      name: 'tools.thought.used Test Tool Label',
    })
    toggle.focus()
    await user.keyboard(' ')
    expect(screen.getByText('tools.thought.requestTitle')).toBeInTheDocument()

    await user.keyboard('{Enter}')
    expect(screen.queryByText('tools.thought.requestTitle')).not.toBeInTheDocument()
  })
})
