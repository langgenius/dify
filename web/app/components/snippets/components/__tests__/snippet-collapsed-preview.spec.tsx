import { render, screen } from '@testing-library/react'
import { SnippetCollapsedPreview } from '../snippet-collapsed-preview'

describe('SnippetCollapsedPreview', () => {
  it('should render collapsed route navigation and input field count', () => {
    render(<SnippetCollapsedPreview inputFieldCount={2} snippetId="snippet-1" />)

    expect(screen.getByRole('link', { name: 'snippet.sectionOrchestrate' })).toHaveAttribute(
      'href',
      '/snippets/snippet-1/orchestrate',
    )
    expect(screen.getByLabelText('2 snippet.inputVariables')).toHaveTextContent('2')
  })
})
