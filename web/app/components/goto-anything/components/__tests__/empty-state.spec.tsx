import { render, screen } from '@testing-library/react'
import { EmptyState } from '../empty-state'

describe('EmptyState', () => {
  it('reports loading', () => {
    render(<EmptyState variant="loading" />)

    expect(screen.getByText('app.gotoAnything.searching')).toBeInTheDocument()
  })

  it('shows a supplied error message', () => {
    render(<EmptyState variant="error" error={new Error('Connection failed')} />)

    expect(screen.getByText('app.gotoAnything.searchFailed')).toBeInTheDocument()
    expect(screen.getByText('Connection failed')).toBeInTheDocument()
  })

  it('falls back to the generic service error', () => {
    render(<EmptyState variant="error" />)

    expect(screen.getByText('app.gotoAnything.searchTemporarilyUnavailable')).toBeInTheDocument()
  })

  it.each([
    ['general', 'app.gotoAnything.noResults'],
    ['@app', 'app.gotoAnything.emptyState.noAppsFound'],
    ['@plugin', 'app.gotoAnything.emptyState.noPluginsFound'],
    ['@knowledge', 'app.gotoAnything.emptyState.noKnowledgeBasesFound'],
    ['@node', 'app.gotoAnything.emptyState.noWorkflowNodesFound'],
  ])('shows the no-results message for %s search', (searchMode, message) => {
    render(<EmptyState variant="no-results" searchMode={searchMode} />)

    expect(screen.getByText(message)).toBeInTheDocument()
  })
})
