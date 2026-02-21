import type { SearchResult } from '../../actions/types'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Command } from 'cmdk'
import ResultList from '../result-list'

function renderInCommandRoot(ui: React.ReactElement) {
  return render(<Command>{ui}</Command>)
}

function createResult(overrides: Partial<SearchResult> = {}): SearchResult {
  return {
    id: 'test-1',
    title: 'Result 1',
    type: 'app',
    data: {},
    ...overrides,
  } as SearchResult
}

describe('ResultList', () => {
  it('renders grouped results with headings', () => {
    const grouped: Record<string, SearchResult[]> = {
      app: [createResult({ id: 'a1', title: 'App One', type: 'app' })],
      plugin: [createResult({ id: 'p1', title: 'Plugin One', type: 'plugin' })],
    }

    renderInCommandRoot(
      <ResultList groupedResults={grouped} onSelect={vi.fn()} />,
    )

    expect(screen.getByText('App One')).toBeInTheDocument()
    expect(screen.getByText('Plugin One')).toBeInTheDocument()
  })

  it('renders multiple results in the same group', () => {
    const grouped: Record<string, SearchResult[]> = {
      app: [
        createResult({ id: 'a1', title: 'App One', type: 'app' }),
        createResult({ id: 'a2', title: 'App Two', type: 'app' }),
      ],
    }

    renderInCommandRoot(
      <ResultList groupedResults={grouped} onSelect={vi.fn()} />,
    )

    expect(screen.getByText('App One')).toBeInTheDocument()
    expect(screen.getByText('App Two')).toBeInTheDocument()
  })

  it('calls onSelect with the correct result when clicked', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    const result = createResult({ id: 'a1', title: 'Click Me', type: 'app' })

    renderInCommandRoot(
      <ResultList groupedResults={{ app: [result] }} onSelect={onSelect} />,
    )

    await user.click(screen.getByText('Click Me'))

    expect(onSelect).toHaveBeenCalledWith(result)
  })

  it('renders empty when no grouped results provided', () => {
    const { container } = renderInCommandRoot(
      <ResultList groupedResults={{}} onSelect={vi.fn()} />,
    )

    const groups = container.querySelectorAll('[cmdk-group]')
    expect(groups).toHaveLength(0)
  })

  it('uses i18n keys for known group types', () => {
    const grouped: Record<string, SearchResult[]> = {
      command: [createResult({ id: 'c1', title: 'Cmd', type: 'command' })],
    }

    renderInCommandRoot(
      <ResultList groupedResults={grouped} onSelect={vi.fn()} />,
    )

    expect(screen.getByText('app.gotoAnything.groups.commands')).toBeInTheDocument()
  })
})
