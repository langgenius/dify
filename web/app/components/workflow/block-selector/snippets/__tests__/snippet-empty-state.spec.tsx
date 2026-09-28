import { render, screen } from '@testing-library/react'
import SnippetEmptyState from '../snippet-empty-state'

describe('SnippetEmptyState', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Rendering', () => {
    it('should render empty state copy without create action', () => {
      render(<SnippetEmptyState />)

      expect(screen.getByText('workflow.tabs.noSnippetsFound')).toBeInTheDocument()
      expect(
        screen.queryByRole('button', { name: 'workflow.tabs.createSnippet' }),
      ).not.toBeInTheDocument()
    })
  })
})
