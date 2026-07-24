import type { SearchResult } from '../../actions/types'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Command } from 'cmdk'
import ResultItem from '../result-item'

function renderInCommandRoot(ui: React.ReactElement) {
  return render(<Command>{ui}</Command>)
}

function createResult(overrides: Partial<SearchResult> = {}): SearchResult {
  return {
    id: 'test-1',
    title: 'Test Result',
    type: 'app',
    data: {},
    ...overrides,
  } as SearchResult
}

describe('ResultItem', () => {
  it('renders title', () => {
    renderInCommandRoot(
      <ResultItem result={createResult({ title: 'My App' })} onSelect={vi.fn()} />,
    )

    expect(screen.getByText('My App')).toBeInTheDocument()
  })

  it('renders description when provided', () => {
    renderInCommandRoot(
      <ResultItem
        result={createResult({ description: 'A great app' })}
        onSelect={vi.fn()}
      />,
    )

    expect(screen.getByText('A great app')).toBeInTheDocument()
  })

  it('does not render description when absent', () => {
    const result = createResult()
    delete (result as Record<string, unknown>).description

    renderInCommandRoot(
      <ResultItem result={result} onSelect={vi.fn()} />,
    )

    expect(screen.getByText('Test Result')).toBeInTheDocument()
    expect(screen.getByText('app')).toBeInTheDocument()
  })

  it('renders result type label', () => {
    renderInCommandRoot(
      <ResultItem result={createResult({ type: 'plugin' })} onSelect={vi.fn()} />,
    )

    expect(screen.getByText('plugin')).toBeInTheDocument()
  })

  it('renders icon when provided', () => {
    const icon = <span data-testid="custom-icon">icon</span>
    renderInCommandRoot(
      <ResultItem result={createResult({ icon })} onSelect={vi.fn()} />,
    )

    expect(screen.getByTestId('custom-icon')).toBeInTheDocument()
  })

  it('calls onSelect when clicked', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()

    renderInCommandRoot(
      <ResultItem result={createResult()} onSelect={onSelect} />,
    )

    await user.click(screen.getByText('Test Result'))

    expect(onSelect).toHaveBeenCalled()
  })
})
